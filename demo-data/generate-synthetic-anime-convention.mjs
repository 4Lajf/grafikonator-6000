import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faker } from '@faker-js/faker';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
faker.seed(6000);

const SUBMISSIONS_PATH = path.join(__dirname, 'synthetic-anime-convention-submissions.csv');
const ROOMS_PATH = path.join(__dirname, 'synthetic-anime-convention-rooms.csv');

const CONVENTION_DATES = {
	saturday: '2026-09-30',
	sunday: '2026-10-01'
};

const CAPACITY_STEPS = [20, 50, 100, 200];
const CONVENTION_DAY_WINDOWS = [
	{ date: CONVENTION_DATES.saturday, start: '08:00', end: '22:00' },
	{ date: CONVENTION_DATES.sunday, start: '08:00', end: '22:00' }
];
const TARGET_FILL_MULTIPLIER = 0.95;
const MIN_FILL_MULTIPLIER = 0.9;
const MAX_FILL_MULTIPLIER = 0.98;

const AVAILABILITY = {
	full: 'Pasuje mi przez cały konwent',
	satDay: 'sobota (30/09) 11:00 - 14:00, sobota (30/09) 14:00 - 18:00',
	satAfternoon: 'sobota (30/09) 14:00 - 18:00, sobota (30/09) 18:00 - 22:00',
	satPrime: 'sobota (30/09) 18:00 - 22:00',
	satEveningNight: 'sobota (30/09) 18:00 - 22:00, sobota (30/09) 22:00 - 2:00',
	satNight: 'sobota (30/09) 18:00 - 22:00, sobota (30/09) 22:00 - 2:00, nocka 2:00 - 9:00',
	sunMorning: 'niedziela (01/10) 9:00 - 12:00',
	sunMidday: 'niedziela (01/10) 12:00 - 15:00',
	sun: 'niedziela (01/10) 9:00 - 12:00, niedziela (01/10) 12:00 - 15:00',
	weekendNoNight:
		'sobota (30/09) 11:00 - 14:00, sobota (30/09) 14:00 - 18:00, sobota (30/09) 18:00 - 22:00, niedziela (01/10) 9:00 - 12:00, niedziela (01/10) 12:00 - 15:00',
	after15:
		'sobota (30/09) 18:00 - 22:00, sobota (30/09) 22:00 - 2:00, niedziela (01/10) 12:00 - 15:00'
};

const rooms = [
	{
		name: 'Main Stage',
		capacity: 200,
		tags: ['main_stage'],
		noisePolicy: 'loud_ok',
		notes: 'Best for opening, cosplay, concerts, dance shows and other headline events.'
	},
	{
		name: 'Auditorium',
		capacity: 200,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Large seated room for high-interest talks and guest panels.'
	},
	{
		name: 'Contest Room',
		capacity: 200,
		tags: [],
		noisePolicy: 'loud_ok',
		notes: 'Quiz and competition room with audio and scoring setup.'
	},
	{
		name: 'Panel Room A',
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	{
		name: 'Panel Room B',
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	{
		name: 'Panel Room C',
		capacity: 100,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Standard lecture room.'
	},
	{
		name: 'Workshop Room',
		capacity: 100,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Tables and material handling for craft sessions.'
	},
	{
		name: 'Small Club Room',
		capacity: 20,
		tags: [],
		noisePolicy: 'quiet',
		notes: 'Small discussion room for niche sessions.'
	},
	{
		name: 'Open Corridor Zone',
		capacity: 100,
		tags: [],
		noisePolicy: 'normal',
		notes: 'Drop-in hallway activities and short social events.'
	},
	{
		name: 'Rhythm Games Zone',
		capacity: 100,
		tags: [],
		noisePolicy: 'loud_ok',
		notes: 'Dedicated rhythm game corner.'
	}
];

const roomByName = new Map(rooms.map((room) => [room.name, room]));

function formatDateTime(date) {
	return date.toISOString().replace('T', ' ').slice(0, 19);
}

function fakeTimestamp() {
	return formatDateTime(
		faker.date.between({
			from: '2026-07-01T08:00:00.000Z',
			to: '2026-07-28T22:00:00.000Z'
		})
	);
}

function fakePublicDescription(title, kind) {
	const audience = faker.helpers.arrayElement([
		'fans of seasonal anime',
		'cosplayers looking for practical ideas',
		'players who enjoy chaotic quizzes',
		'people curious about Japanese pop culture',
		'participants who want a relaxed convention break'
	]);
	const format = faker.helpers.arrayElement([
		'a guided talk with audience questions',
		'a multimedia session with examples from recent series',
		'a practical convention activity with a clear beginner-friendly flow',
		'a lively fan event built around shared recommendations',
		'a focused session with space for discussion at the end'
	]);
	const vibe = faker.helpers.arrayElement([
		'beginner-friendly',
		'energetic',
		'nostalgic',
		'lightly competitive',
		'deep-dive'
	]);
	return `${title} is a ${vibe} ${kind.toLowerCase()} for ${audience}. Expect ${format}, synthetic examples, and no real attendee data.`;
}

function fakeOrganizerNotes(title) {
	const setupHint = faker.helpers.arrayElement([
		'reserve the first row for helpers',
		'check projector input before doors open',
		'prepare a visible queue line',
		'keep a short microphone test before start',
		'leave space near the door for late arrivals'
	]);
	const risk = faker.helpers.arrayElement([
		'watch capacity closely if the room starts filling early',
		'mark this as low risk for content moderation',
		'confirm equipment before opening the room',
		'keep a volunteer nearby for queue control',
		'avoid placing another loud event next door'
	]);
	return `Synthetic organizer note for ${title}: ${setupHint}; ${risk}.`;
}

function fakeComments() {
	const note = faker.helpers.arrayElement([
		'presenter prefers a short setup check',
		'event can be moved within declared availability',
		'room signage should be visible',
		'late arrivals are expected',
		'helper support is welcome but not required'
	]);
	return `Synthetic data: ${note}. No private contact data is included.`;
}

function fakeExperience() {
	return `${faker.person.jobTitle()} with ${faker.number.int({ min: 1, max: 12 })} years of community experience and ${faker.number.int({ min: 1, max: 24 })} previous fan-event sessions.`;
}

const usedPseudonyms = new Set();
const usedTitles = new Set();

function fakePseudonim() {
	for (let attempt = 0; attempt < 40; attempt++) {
		const candidate = faker.helpers.arrayElement([
			() => faker.internet.displayName(),
			() => faker.internet.username(),
			() =>
				`${faker.person.firstName()} ${faker.helpers.arrayElement([
					'Chan',
					'San',
					'Neko',
					'Star',
					'Art',
					'Draws',
					'Reads',
					'Quest'
				])}`,
			() =>
				`${faker.helpers.arrayElement([
					'Cosplay',
					'Anime',
					'Manga',
					'Idol',
					'Retro',
					'Night',
					'Moon',
					'Pixel'
				])} ${faker.helpers.arrayElement(['Circle', 'Club', 'Crew', 'Lab', 'Atelier', 'Guild', 'Collective'])}`,
			() => faker.person.fullName()
		])();
		if (!usedPseudonyms.has(candidate)) {
			usedPseudonyms.add(candidate);
			return candidate;
		}
	}
	const fallback = `${faker.internet.username()}_${faker.string.alphanumeric(4)}`;
	usedPseudonyms.add(fallback);
	return fallback;
}

function fakeEventTitle(kind, input = {}) {
	const topic = faker.helpers.arrayElement([
		'anime sezonu',
		'cosplay od podstaw',
		'manga shoujo',
		'openingi i endingi',
		'Genshin lore',
		'idol culture',
		'retro handheldy',
		'VTuber fandom',
		'japońskie gry RPG',
		'Studio Ghibli',
		'isekai tropes',
		'convention survival',
		'anime horror',
		'polski dubbing',
		'rhythm games',
		'makijaż postaci',
		'origami i crafts',
		'anime muzyka',
		'manga paneling',
		'fandom online'
	]);
	const templates = {
		Prelekcja: () =>
			faker.helpers.arrayElement([
				`Prelekcja: ${topic}`,
				`${faker.helpers.arrayElement(['Dlaczego', 'Jak', 'Co to jest'])} ${topic}?`,
				`${faker.word.adjective()} przewodnik po ${topic}`,
				`${topic} — ${faker.lorem.words({ min: 2, max: 4 })}`
			]),
		Panel: () =>
			faker.helpers.arrayElement([
				`Panel: ${topic}`,
				`Spotkanie z fanami — ${topic}`,
				`Q&A: ${topic}`
			]),
		Konkurs: () =>
			faker.helpers.arrayElement([
				`Konkurs wiedzy: ${topic}`,
				`Wiedzówka — ${topic}`,
				`Quiz ${faker.number.int({ min: 2024, max: 2026 })}: ${topic}`
			]),
		Warsztaty: () =>
			faker.helpers.arrayElement([
				`Warsztaty: ${topic}`,
				`Warsztat praktyczny — ${topic}`,
				`${faker.helpers.arrayElement(['Nauka', 'Wprowadzenie do'])} ${topic}`
			]),
		Pokaz: () =>
			faker.helpers.arrayElement([
				`Pokaz: ${topic}`,
				`Live demo — ${topic}`,
				`Sceniczny set: ${topic}`
			]),
		Koncert: () =>
			faker.helpers.arrayElement([
				`Koncert: ${topic}`,
				`Live set — ${topic}`,
				`Anisong night: ${topic}`
			]),
		Turniej: () =>
			faker.helpers.arrayElement([
				`Turniej: ${topic}`,
				`Open tournament — ${topic}`,
				`Bracket battle: ${topic}`
			]),
		Wydarzenie: () =>
			faker.helpers.arrayElement(
				[
					input.anchor === 'opening'
						? faker.helpers.arrayElement([
								'Ceremonia otwarcia konwentu',
								'Otwarcie NekoMatsuri',
								'Oficjalne otwarcie programu'
							])
						: input.anchor === 'closing'
							? faker.helpers.arrayElement([
									'Podsumowanie konwentu',
									'Ceremonia zamknięcia i nagrody',
									'Finał konwentu'
								])
							: null,
					`Wydarzenie specjalne: ${topic}`,
					`Gala: ${topic}`,
					`${faker.helpers.arrayElement(['Integracja', 'Spotkanie'])} — ${topic}`
				].filter(Boolean)
			),
		Integracja: () =>
			faker.helpers.arrayElement([
				`Integracja: ${topic}`,
				`Spontaniczna zabawa — ${topic}`,
				`Open activity: ${topic}`
			])
	};

	for (let attempt = 0; attempt < 40; attempt++) {
		const builder = templates[kind] ?? templates.Prelekcja;
		const candidate = builder();
		if (!usedTitles.has(candidate)) {
			usedTitles.add(candidate);
			return candidate;
		}
	}
	const fallback = `${kind}: ${topic} ${faker.string.alphanumeric(4)}`;
	usedTitles.add(fallback);
	return fallback;
}

function event(input) {
	const title = fakeEventTitle(input.kind, input);
	const presenter = fakePseudonim();
	const titleSlug = title
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
	return {
		id: input.id,
		timestamp: input.timestamp ?? fakeTimestamp(),
		presenter,
		title,
		kind: input.kind,
		durationHours: input.durationHours,
		description: input.description ?? fakePublicDescription(title, input.kind),
		organizerNotes: input.organizerNotes ?? fakeOrganizerNotes(title),
		adultContent: input.adultContent ?? 'nie',
		availability: input.availability ?? AVAILABILITY.full,
		laptop: input.laptop ?? 'Potrzebuję od was',
		speakers:
			input.speakers ??
			(input.requiredTags?.includes('loud_audio')
				? 'Potrzebuję od was'
				: 'Atrakcja nie wymaga dźwięku'),
		lodging: input.lodging ?? 'Nie dotyczy w danych demo',
		comments: input.comments ?? fakeComments(),
		experience: input.experience ?? fakeExperience(),
		tier: input.tier,
		attendance: input.attendance,
		requiredTags: input.requiredTags ?? [],
		bufferBefore: input.bufferBefore ?? 0,
		bufferAfter: input.bufferAfter ?? 0,
		avoidConflicts: input.avoidConflicts ?? '',
		ageRating: input.ageRating ?? 'all ages',
		noiseLevel: input.noiseLevel ?? 'normal',
		interactionLevel: input.interactionLevel ?? input.kind,
		equipmentNeeds: input.equipmentNeeds ?? [],
		setupComplexity: input.setupComplexity ?? 'none',
		canRepeat: input.canRepeat ?? 'no',
		language: input.language ?? 'PL',
		remote: input.remote ?? 'no',
		autoSchedule: input.autoSchedule ?? 'tak',
		anchor: input.anchor ?? null,
		block: input.block ?? inferBlock(input.kind, input.requiredTags ?? []),
		slug: titleSlug,
		schedule: null
	};
}

function inferBlock(kind, requiredTags = []) {
	if (requiredTags.includes('main_stage')) return 'Main Stage';
	if (requiredTags.includes('workshop_tables')) return 'Cosplay';
	if (requiredTags.includes('rhythm_games')) return 'Gry';
	if (requiredTags.includes('contest') || kind === 'Konkurs') return 'Manga & Anime';
	if (kind === 'Integracja' || requiredTags.includes('open_area')) return 'Integracja';
	if (kind === 'Wydarzenie' || kind === 'Pokaz' || kind === 'Koncert') return 'Main Stage';
	return 'Manga & Anime';
}

const events = [
	event({
		id: 1,
		anchor: 'opening',
		kind: 'Wydarzenie',
		durationHours: 0.5,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage'],
		equipmentNeeds: ['microphone', 'large_screen'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		bufferBefore: 20,
		bufferAfter: 10,
		schedule: { date: CONVENTION_DATES.saturday, start: '11:00', end: '11:30', room: 'Main Stage' }
	}),
	event({
		id: 2,
		kind: 'Pokaz',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['main_stage'],
		equipmentNeeds: ['microphone'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		availability: AVAILABILITY.satDay,
		bufferBefore: 15,
		bufferAfter: 15,
		schedule: { date: CONVENTION_DATES.saturday, start: '13:00', end: '14:00', room: 'Main Stage' }
	}),
	event({
		id: 3,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage', 'loud_audio'],
		equipmentNeeds: ['microphone', 'speakers', 'large_screen'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		availability: AVAILABILITY.satAfternoon,
		bufferBefore: 30,
		bufferAfter: 20,
		avoidConflicts: 'cosplay green room, photographer meetup',
		schedule: { date: CONVENTION_DATES.saturday, start: '16:00', end: '18:00', room: 'Main Stage' }
	}),
	event({
		id: 4,
		kind: 'Pokaz',
		durationHours: 1,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage', 'loud_audio'],
		equipmentNeeds: ['speakers', 'microphone'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		availability: AVAILABILITY.satPrime,
		bufferBefore: 20,
		bufferAfter: 15,
		schedule: { date: CONVENTION_DATES.saturday, start: '18:30', end: '19:30', room: 'Main Stage' }
	}),
	event({
		id: 5,
		kind: 'Koncert',
		durationHours: 1,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage', 'loud_audio'],
		equipmentNeeds: ['internet', 'speakers', 'microphone', 'large_screen'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		availability: AVAILABILITY.satPrime,
		remote: 'yes',
		setupComplexity: 'large',
		bufferBefore: 30,
		bufferAfter: 15,
		schedule: { date: CONVENTION_DATES.saturday, start: '20:00', end: '21:00', room: 'Main Stage' }
	}),
	event({
		id: 6,
		kind: 'Wydarzenie',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['main_stage', 'large_screen'],
		equipmentNeeds: ['projector', 'speakers'],
		noiseLevel: 'normal',
		interactionLevel: 'screening',
		availability: AVAILABILITY.satEveningNight,
		schedule: { date: CONVENTION_DATES.saturday, start: '21:30', end: '22:30', room: 'Main Stage' }
	}),
	event({
		id: 7,
		anchor: 'closing',
		kind: 'Wydarzenie',
		durationHours: 1,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage'],
		equipmentNeeds: ['microphone'],
		noiseLevel: 'normal',
		interactionLevel: 'performance',
		availability: AVAILABILITY.sunMidday,
		bufferBefore: 15,
		bufferAfter: 10,
		schedule: { date: CONVENTION_DATES.sunday, start: '14:00', end: '15:00', room: 'Main Stage' }
	}),
	event({
		id: 8,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: { date: CONVENTION_DATES.saturday, start: '11:00', end: '12:00', room: 'Auditorium' }
	}),
	event({
		id: 9,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector', 'speakers'],
		availability: AVAILABILITY.weekendNoNight,
		schedule: { date: CONVENTION_DATES.saturday, start: '12:00', end: '13:00', room: 'Auditorium' }
	}),
	event({
		id: 10,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.weekendNoNight,
		schedule: { date: CONVENTION_DATES.saturday, start: '13:00', end: '14:00', room: 'Auditorium' }
	}),
	event({
		id: 11,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: { date: CONVENTION_DATES.saturday, start: '14:00', end: '15:00', room: 'Auditorium' }
	}),
	event({
		id: 12,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 1,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector', 'speakers'],
		availability: AVAILABILITY.satAfternoon,
		schedule: { date: CONVENTION_DATES.saturday, start: '16:00', end: '17:00', room: 'Auditorium' }
	}),
	event({
		id: 13,
		kind: 'Panel',
		durationHours: 1,
		tier: 1,
		attendance: 200,
		requiredTags: ['projector'],
		equipmentNeeds: ['microphone', 'projector'],
		availability: AVAILABILITY.satAfternoon,
		setupComplexity: 'small',
		bufferBefore: 10,
		bufferAfter: 10,
		schedule: { date: CONVENTION_DATES.saturday, start: '17:00', end: '18:00', room: 'Auditorium' }
	}),
	event({
		id: 14,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satPrime,
		ageRating: '16+',
		schedule: { date: CONVENTION_DATES.saturday, start: '18:00', end: '19:00', room: 'Auditorium' }
	}),
	event({
		id: 15,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.weekendNoNight,
		schedule: { date: CONVENTION_DATES.saturday, start: '19:00', end: '20:00', room: 'Auditorium' }
	}),
	event({
		id: 16,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satEveningNight,
		ageRating: '16+',
		schedule: { date: CONVENTION_DATES.saturday, start: '21:00', end: '22:00', room: 'Auditorium' }
	}),
	event({
		id: 17,
		kind: 'Konkurs',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector', 'speakers'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '11:00',
			end: '12:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 18,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 2,
		attendance: 100,
		requiredTags: ['contest', 'projector', 'loud_audio'],
		equipmentNeeds: ['projector', 'speakers'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.weekendNoNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '12:00',
			end: '14:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 19,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 2,
		attendance: 100,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '14:00',
			end: '16:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 20,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 1,
		attendance: 100,
		requiredTags: ['contest', 'projector', 'loud_audio'],
		equipmentNeeds: ['projector', 'speakers'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '16:00',
			end: '18:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 21,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 1,
		attendance: 100,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.satEveningNight,
		avoidConflicts: 'Genshin lore panel',
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '18:00',
			end: '20:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 22,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 1,
		attendance: 100,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.satEveningNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '20:00',
			end: '22:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 23,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 3,
		attendance: 50,
		requiredTags: ['contest'],
		equipmentNeeds: ['paper', 'markers'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.satNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '22:00',
			end: '00:00',
			room: 'Contest Room'
		}
	}),
	event({
		id: 24,
		kind: 'Warsztaty',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '11:00',
			end: '12:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 25,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '12:00',
			end: '13:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 26,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.weekendNoNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '13:00',
			end: '14:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 27,
		kind: 'Warsztaty',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['workshop_tables', 'materials'],
		equipmentNeeds: ['tables', 'paint', 'brushes'],
		interactionLevel: 'workshop',
		setupComplexity: 'large',
		availability: AVAILABILITY.satAfternoon,
		bufferBefore: 20,
		bufferAfter: 20,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '14:00',
			end: '16:00',
			room: 'Workshop Room'
		}
	}),
	event({
		id: 28,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '16:00',
			end: '17:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 29,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '17:00',
			end: '18:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 30,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satPrime,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '19:00',
			end: '20:00',
			room: 'Panel Room A'
		}
	}),
	event({
		id: 31,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '11:00',
			end: '12:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 32,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '12:00',
			end: '13:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 33,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		ageRating: '16+',
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '14:00',
			end: '15:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 34,
		kind: 'Prelekcja',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '15:00',
			end: '17:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 35,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		ageRating: '16+',
		availability: AVAILABILITY.satPrime,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '18:00',
			end: '19:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 36,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satPrime,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '20:00',
			end: '21:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 37,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 3,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satEveningNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '22:00',
			end: '23:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 38,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 3,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		ageRating: '16+',
		availability: AVAILABILITY.satNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '23:00',
			end: '00:00',
			room: 'Panel Room B'
		}
	}),
	event({
		id: 39,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '11:00',
			end: '12:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 40,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '12:00',
			end: '13:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 41,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satDay,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '13:00',
			end: '14:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 42,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '14:00',
			end: '15:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 43,
		kind: 'Prelekcja',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '15:00',
			end: '17:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 44,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.satAfternoon,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '17:00',
			end: '19:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 45,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.satPrime,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '19:00',
			end: '20:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 46,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector', 'speakers'],
		availability: AVAILABILITY.satPrime,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '21:00',
			end: '22:00',
			room: 'Panel Room C'
		}
	}),
	event({
		id: 47,
		kind: 'Prelekcja',
		durationHours: 3,
		tier: 3,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		adultContent: 'tak',
		ageRating: '18+',
		availability: AVAILABILITY.satNight,
		schedule: { date: CONVENTION_DATES.sunday, start: '02:00', end: '05:00', room: 'Panel Room C' }
	}),
	event({
		id: 48,
		kind: 'Warsztaty',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['workshop_tables', 'materials'],
		equipmentNeeds: ['paper', 'tables'],
		interactionLevel: 'workshop',
		setupComplexity: 'small',
		availability: AVAILABILITY.full,
		bufferBefore: 10,
		bufferAfter: 10,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '11:00',
			end: '13:00',
			room: 'Workshop Room'
		}
	}),
	event({
		id: 49,
		kind: 'Warsztaty',
		durationHours: 1,
		tier: 2,
		attendance: 20,
		requiredTags: ['workshop_tables', 'materials'],
		equipmentNeeds: ['paper', 'tables'],
		interactionLevel: 'workshop',
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '14:00', end: '15:00', room: 'Workshop Room' }
	}),
	event({
		id: 50,
		kind: 'Warsztaty',
		durationHours: 0.5,
		tier: 3,
		attendance: 50,
		requiredTags: ['open_area'],
		equipmentNeeds: ['speaker'],
		noiseLevel: 'loud',
		interactionLevel: 'drop-in',
		canRepeat: 'yes',
		availability: AVAILABILITY.weekendNoNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '15:00',
			end: '15:30',
			room: 'Open Corridor Zone'
		}
	}),
	event({
		id: 51,
		kind: 'Turniej',
		durationHours: 1,
		tier: 3,
		attendance: 20,
		requiredTags: ['open_area'],
		equipmentNeeds: ['paper', 'pencils'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.weekendNoNight,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '20:00',
			end: '21:00',
			room: 'Open Corridor Zone'
		}
	}),
	event({
		id: 52,
		kind: 'Warsztaty',
		durationHours: 2,
		tier: 2,
		attendance: 50,
		requiredTags: ['open_area'],
		equipmentNeeds: ['chairs'],
		interactionLevel: 'workshop',
		availability: AVAILABILITY.sun,
		schedule: {
			date: CONVENTION_DATES.sunday,
			start: '12:00',
			end: '14:00',
			room: 'Open Corridor Zone'
		}
	}),
	event({
		id: 53,
		kind: 'Turniej',
		durationHours: 3,
		tier: 2,
		attendance: 50,
		requiredTags: ['rhythm_games', 'loud_audio'],
		equipmentNeeds: ['rhythm cabinet', 'speakers'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.satAfternoon,
		bufferBefore: 20,
		bufferAfter: 15,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '15:00',
			end: '18:00',
			room: 'Rhythm Games Zone'
		}
	}),
	event({
		id: 54,
		kind: 'Turniej',
		durationHours: 3,
		tier: 2,
		attendance: 50,
		requiredTags: ['rhythm_games', 'loud_audio'],
		equipmentNeeds: ['rhythm cabinet', 'speakers'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.satEveningNight,
		bufferBefore: 20,
		bufferAfter: 15,
		schedule: {
			date: CONVENTION_DATES.saturday,
			start: '20:00',
			end: '23:00',
			room: 'Rhythm Games Zone'
		}
	}),
	event({
		id: 55,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 3,
		attendance: 20,
		requiredTags: ['quiet_room'],
		equipmentNeeds: [],
		noiseLevel: 'quiet',
		interactionLevel: 'lecture',
		availability: AVAILABILITY.sunMorning,
		schedule: {
			date: CONVENTION_DATES.sunday,
			start: '10:00',
			end: '11:00',
			room: 'Small Club Room'
		}
	}),
	event({
		id: 56,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 3,
		attendance: 20,
		requiredTags: ['quiet_room'],
		equipmentNeeds: [],
		noiseLevel: 'quiet',
		interactionLevel: 'lecture',
		availability: AVAILABILITY.sun,
		schedule: {
			date: CONVENTION_DATES.sunday,
			start: '12:00',
			end: '13:00',
			room: 'Small Club Room'
		}
	}),
	event({
		id: 57,
		kind: 'Warsztaty',
		durationHours: 2,
		tier: 1,
		attendance: 200,
		requiredTags: ['main_stage', 'loud_audio'],
		equipmentNeeds: ['speakers', 'microphone'],
		noiseLevel: 'loud',
		interactionLevel: 'performance',
		availability: AVAILABILITY.sun,
		bufferBefore: 20,
		bufferAfter: 15,
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '14:00', room: 'Main Stage' }
	}),
	event({
		id: 58,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '11:00', end: '12:00', room: 'Auditorium' }
	}),
	event({
		id: 59,
		kind: 'Prelekcja',
		durationHours: 2,
		tier: 1,
		attendance: 200,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		avoidConflicts: 'Hardkorowa wiedzówka z Genshina',
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '14:00', room: 'Auditorium' }
	}),
	event({
		id: 60,
		kind: 'Konkurs',
		durationHours: 1,
		tier: 2,
		attendance: 100,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.sun,
		avoidConflicts: 'cosplay contest',
		schedule: { date: CONVENTION_DATES.sunday, start: '11:00', end: '12:00', room: 'Contest Room' }
	}),
	event({
		id: 61,
		kind: 'Konkurs',
		durationHours: 2,
		tier: 1,
		attendance: 100,
		requiredTags: ['contest', 'projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '14:00', room: 'Contest Room' }
	}),
	event({
		id: 62,
		kind: 'Warsztaty',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['workshop_tables', 'materials'],
		equipmentNeeds: ['paper', 'pencils', 'tables'],
		interactionLevel: 'workshop',
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '10:00', end: '11:00', room: 'Workshop Room' }
	}),
	event({
		id: 63,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '13:00', room: 'Panel Room A' }
	}),
	event({
		id: 64,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '13:00', end: '14:00', room: 'Panel Room A' }
	}),
	event({
		id: 65,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '13:00', room: 'Panel Room B' }
	}),
	event({
		id: 66,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '13:00', end: '14:00', room: 'Panel Room B' }
	}),
	event({
		id: 67,
		kind: 'Konkurs',
		durationHours: 1,
		tier: 3,
		attendance: 50,
		requiredTags: ['projector', 'loud_audio'],
		equipmentNeeds: ['projector', 'speakers', 'controller'],
		noiseLevel: 'loud',
		interactionLevel: 'contest',
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '14:00', end: '15:00', room: 'Contest Room' }
	}),
	event({
		id: 68,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '11:00', end: '12:00', room: 'Panel Room C' }
	}),
	event({
		id: 69,
		kind: 'Prelekcja',
		durationHours: 1,
		tier: 2,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '12:00', end: '13:00', room: 'Panel Room C' }
	}),
	event({
		id: 70,
		kind: 'Konkurs',
		durationHours: 1,
		tier: 3,
		attendance: 50,
		requiredTags: ['projector'],
		equipmentNeeds: ['projector'],
		interactionLevel: 'contest',
		availability: AVAILABILITY.sun,
		schedule: { date: CONVENTION_DATES.sunday, start: '13:00', end: '14:00', room: 'Panel Room C' }
	})
];

function formatDuration(durationHours) {
	if (durationHours === 0.5) return '30 min';
	if (durationHours === 1.5) return '90 min';
	if (Number.isInteger(durationHours)) return String(durationHours);
	return `${durationHours} h`;
}

function serializeList(values) {
	return values.join(',');
}

function submissionRows() {
	return events.map((item) => ({
		'Sygnatura czasowa': item.timestamp,
		Pseudonim: item.presenter,
		'Tytuł atrakcji': item.title,
		'Typ atrakcji': item.kind,
		'Czas trwania atrakcji (w godzinach)': formatDuration(item.durationHours),
		'Opis atrakcji dla uczestników': item.description,
		'Opis atrakcji dla organizatora (jeśli czujesz potrzebę dokładniejszego opisu przebiegu)':
			item.organizerNotes,
		'Czy atrakcja zawiera treści dla dorosłych?': item.adultContent,
		'Dyspozycyjność (preferowane godziny trwania atrakcji)\n\nZaznaczasz wszystkie, które Ci pasują.':
			item.availability,
		'Czy potrzebujesz laptopa?': item.laptop,
		'Czy potrzebujesz głośników?': item.speakers,
		'Czy potrzebujesz noclegu?': item.lodging,
		'Miejsce na wszelkie inne uwagi': item.comments,
		'Doświadczenie/referencje': item.experience,
		'Priorytet atrakcji (Tier 1–3)': item.tier,
		'Szacowana frekwencja': item.attendance,
		'Wymagane tagi sali': serializeList(item.requiredTags),
		'Wymagane wyposażenie': serializeList(item.equipmentNeeds),
		'Auto-planowanie': item.autoSchedule,
		'Klauzula RODO:': 'Wyrażam zgodę'
	}));
}

function roomsRows() {
	return rooms.map((room) => ({
		Sala: room.name,
		Pojemność: room.capacity,
		Tagi: serializeList(room.tags),
		'Polityka hałasu': room.noisePolicy,
		Uwagi: room.notes
	}));
}

function capacityFit(eventItem, room) {
	const gap = room.capacity - eventItem.attendance;
	if (gap < 0) return 'invalid_over_capacity';
	if (gap === 0) return 'exact';
	const eventIndex = CAPACITY_STEPS.indexOf(eventItem.attendance);
	const roomIndex = CAPACITY_STEPS.indexOf(room.capacity);
	const steps = roomIndex - eventIndex;
	if (steps === 1) return 'oversized_1_step';
	if (steps === 2) return 'oversized_2_steps';
	return 'oversized_3_steps';
}

function slotTier(date, start) {
	const startMinute = timeToMinutes(start);
	if (date === CONVENTION_DATES.saturday) {
		if (startMinute >= 16 * 60 && startMinute < 22 * 60) return 1;
		if (startMinute >= 11 * 60 && startMinute < 24 * 60) return 2;
		return 3;
	}
	if (date === CONVENTION_DATES.sunday) {
		if (startMinute >= 12 * 60 && startMinute < 15 * 60) return 1;
		if (startMinute >= 9 * 60 && startMinute < 18 * 60) return 2;
		return 3;
	}
	return 3;
}

function slotFitNote(eventItem) {
	const tier = slotTier(eventItem.schedule.date, eventItem.schedule.start);
	const mismatch = Math.abs(eventItem.tier - tier);
	if (mismatch === 0) return 'event_tier_matches_slot_hype';
	if (isAnchorTierOne(eventItem)) return 'anchor_event_allowed_outside_peak';
	return `event_tier_${eventItem.tier}_slot_tier_${tier}`;
}

function scheduleRows() {
	return events
		.filter((item) => item.schedule)
		.map((item) => {
			const room = roomByName.get(item.schedule.room);
			return {
				id: item.id,
				day: item.schedule.date,
				start: item.schedule.start,
				end: item.schedule.end,
				title: item.title,
				description: item.description,
				speaker: item.presenter,
				room: item.schedule.room,
				room_capacity: room.capacity,
				estimated_attendance: item.attendance,
				capacity_fit: capacityFit(item, room),
				block: item.block,
				type: item.kind,
				priority_tier: item.tier,
				slot_hype_tier: slotTier(item.schedule.date, item.schedule.start),
				slot_fit_note: slotFitNote(item),
				age_rating: item.ageRating,
				noise_level: item.noiseLevel,
				interaction_level: item.interactionLevel,
				required_room_tags: serializeList(item.requiredTags),
				equipment_needs: serializeList(item.equipmentNeeds),
				setup_buffer_before_min: item.bufferBefore,
				setup_buffer_after_min: item.bufferAfter,
				avoid_conflicts: item.avoidConflicts
			};
		});
}

function timeToMinutes(time) {
	const [hours, minutes] = time.split(':').map(Number);
	return hours * 60 + minutes;
}

function dateIndex(date) {
	if (date === CONVENTION_DATES.saturday) return 0;
	if (date === CONVENTION_DATES.sunday) return 1;
	throw new Error(`Unknown date: ${date}`);
}

function absoluteMinute(date, time, isEnd = false) {
	let value = dateIndex(date) * 1440 + timeToMinutes(time);
	if (isEnd && time === '00:00') value += 1440;
	return value;
}

function scheduledInterval(item) {
	const start = absoluteMinute(item.schedule.date, item.schedule.start);
	let end = absoluteMinute(item.schedule.date, item.schedule.end, true);
	if (end <= start) end += 1440;
	return { start, end };
}

function availabilityRanges(text) {
	if (/Pasuje mi przez cały konwent/i.test(text)) {
		return [
			{
				start: absoluteMinute(CONVENTION_DATES.saturday, '00:00'),
				end: absoluteMinute(CONVENTION_DATES.sunday, '00:00') + 1440
			}
		];
	}

	const ranges = [];
	for (const fragment of text.split(',')) {
		const nocka = fragment.match(/nocka\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
		if (nocka) {
			ranges.push({
				start: absoluteMinute(CONVENTION_DATES.sunday, `${nocka[1].padStart(2, '0')}:${nocka[2]}`),
				end: absoluteMinute(CONVENTION_DATES.sunday, `${nocka[3].padStart(2, '0')}:${nocka[4]}`)
			});
			continue;
		}

		const match = fragment.match(
			/\((\d{1,2})\/(\d{1,2})\)\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i
		);
		if (!match) continue;

		const day = match[1].padStart(2, '0');
		const month = match[2].padStart(2, '0');
		const date = `${CONVENTION_DATES.saturday.slice(0, 5)}${month}-${day}`;
		const start = absoluteMinute(date, `${match[3].padStart(2, '0')}:${match[4]}`);
		let end = absoluteMinute(date, `${match[5].padStart(2, '0')}:${match[6]}`);
		if (end <= start) end += 1440;
		ranges.push({ start, end });
	}
	return ranges;
}

function mergeRanges(ranges) {
	return [...ranges]
		.sort((a, b) => a.start - b.start || a.end - b.end)
		.reduce((merged, range) => {
			const previous = merged.at(-1);
			if (previous && range.start <= previous.end) {
				previous.end = Math.max(previous.end, range.end);
				return merged;
			}
			merged.push({ ...range });
			return merged;
		}, []);
}

function fitsAvailability(item) {
	const interval = scheduledInterval(item);
	return mergeRanges(availabilityRanges(item.availability)).some(
		(range) => interval.start >= range.start && interval.end <= range.end
	);
}

function isAnchorTierOne(item) {
	return item.anchor === 'opening' || item.anchor === 'closing';
}

function conventionHoursPerRoom() {
	return CONVENTION_DAY_WINDOWS.reduce(
		(total, window) => total + (timeToMinutes(window.end) - timeToMinutes(window.start)) / 60,
		0
	);
}

function totalConventionRoomHours() {
	return rooms.length * conventionHoursPerRoom();
}

function eventHours(item) {
	return Number(item.durationHours) || 0;
}

function hasRequiredTags(room, item) {
	return item.requiredTags.every((tag) => room.tags.includes(tag));
}

function canHost(room, item) {
	return item.attendance <= room.capacity && hasRequiredTags(room, item);
}

function eligibleRooms(item) {
	return rooms.filter((room) => canHost(room, item));
}

function eligibleHoursForRoom(room) {
	return events
		.filter((item) => canHost(room, item))
		.reduce((total, item) => total + eventHours(item), 0);
}

function eventKindForRoom(room) {
	if (room.tags.includes('main_stage')) {
		return faker.helpers.arrayElement(['Wydarzenie', 'Pokaz', 'Koncert']);
	}
	if (room.tags.includes('contest')) {
		return faker.helpers.arrayElement(['Konkurs', 'Turniej']);
	}
	if (room.tags.includes('workshop_tables')) return 'Warsztaty';
	if (room.tags.includes('open_area')) {
		return faker.helpers.arrayElement(['Warsztaty', 'Integracja', 'Turniej']);
	}
	if (room.tags.includes('rhythm_games')) return 'Turniej';
	return faker.helpers.arrayElement(['Prelekcja', 'Panel', 'Konkurs']);
}

function requiredTagsForRoom(room) {
	if (room.name === 'Main Stage') {
		return ['main_stage'];
	}
	return [];
}

function attendanceForRoom(room) {
	if (room.capacity === 200) return faker.helpers.arrayElement([100, 200]);
	if (room.capacity === 100) return faker.helpers.arrayElement([50, 100]);
	if (room.capacity === 50) return faker.helpers.arrayElement([20, 50]);
	return 20;
}

function availabilityForGeneratedEvent() {
	// Filler submissions are mostly fully flexible so the auto-planner can always
	// fill the grid, while a minority keep a broad (but real) weekend daytime
	// window. The hand-authored core events above carry the genuinely tight
	// windows, so the imported demo shows a realistic mix: most people flexible,
	// some clearly restricted — without making the program impossible to fill.
	return faker.helpers.arrayElement([
		AVAILABILITY.full,
		AVAILABILITY.full,
		AVAILABILITY.full,
		AVAILABILITY.weekendNoNight
	]);
}

function equipmentForTags(tags) {
	const equipment = new Set();
	if (tags.includes('projector') || tags.includes('large_screen')) equipment.add('projector');
	if (tags.includes('loud_audio') || tags.includes('rhythm_games')) equipment.add('speakers');
	if (tags.includes('main_stage')) equipment.add('microphone');
	if (tags.includes('workshop_tables')) equipment.add('tables');
	if (tags.includes('materials')) equipment.add('materials');
	if (tags.includes('open_area')) equipment.add('floor space');
	return [...equipment];
}

function makeGeneratedEvent(id, room) {
	const kind = eventKindForRoom(room);
	const requiredTags = requiredTagsForRoom(room);
	const attendance = attendanceForRoom(room);
	const isBig = attendance >= 100;
	const isStage = requiredTags.includes('main_stage');
	const durationHours = faker.helpers.arrayElement(isStage ? [1, 1, 1.5, 2] : [1, 1, 1, 1.5, 2]);
	const tier =
		isStage || attendance === 200
			? 1
			: attendance === 100
				? 2
				: faker.helpers.arrayElement([2, 2, 3]);
	return event({
		id,
		kind,
		durationHours,
		tier,
		attendance,
		requiredTags,
		equipmentNeeds: equipmentForTags(requiredTags),
		noiseLevel:
			room.noisePolicy === 'loud_ok' ? 'loud' : room.noisePolicy === 'quiet' ? 'quiet' : 'normal',
		interactionLevel: kind === 'Prelekcja' || kind === 'Panel' ? 'lecture' : kind.toLowerCase(),
		availability: availabilityForGeneratedEvent(room),
		setupComplexity: isBig || requiredTags.includes('workshop_tables') ? 'small' : 'none',
		bufferBefore: isBig ? 10 : 0,
		bufferAfter: isBig ? 10 : 0,
		canRepeat: requiredTags.includes('open_area') ? 'yes' : 'no'
	});
}

function expandFreeListToFillRooms() {
	const targetPerRoom = conventionHoursPerRoom();
	const targetTotal = Math.ceil(totalConventionRoomHours() * TARGET_FILL_MULTIPLIER);
	let nextId = Math.max(...events.map((item) => item.id)) + 1;

	while (events.reduce((total, item) => total + eventHours(item), 0) < targetTotal) {
		const room = [...rooms].sort((a, b) => eligibleHoursForRoom(a) - eligibleHoursForRoom(b))[0];
		events.push(makeGeneratedEvent(nextId++, room));
	}

	for (const room of rooms) {
		while (eligibleHoursForRoom(room) < targetPerRoom) {
			events.push(makeGeneratedEvent(nextId++, room));
		}
	}
}

function validateDataset() {
	const errors = [];
	const warnings = [];
	const seenIds = new Set();
	const seenTitles = new Set();
	const targetPerRoom = conventionHoursPerRoom();

	for (const item of events) {
		if (seenIds.has(item.id)) errors.push(`Duplicate event id: ${item.id}`);
		seenIds.add(item.id);

		if (seenTitles.has(item.title)) errors.push(`Duplicate event title: ${item.title}`);
		seenTitles.add(item.title);

		if (!CAPACITY_STEPS.includes(item.attendance)) {
			errors.push(`${item.title}: attendance ${item.attendance} is outside allowed scale`);
		}

		if (eligibleRooms(item).length === 0) {
			errors.push(`${item.title}: no room can satisfy capacity and required tags`);
		}
	}

	for (const room of rooms) {
		if (!CAPACITY_STEPS.includes(room.capacity)) {
			errors.push(`${room.name}: capacity ${room.capacity} is outside allowed scale`);
		}
	}

	for (const room of rooms) {
		const hours = eligibleHoursForRoom(room);
		if (hours < targetPerRoom) {
			errors.push(
				`${room.name}: only ${hours} eligible event-hours for ${targetPerRoom} room-hours`
			);
		}
	}

	const totalEventHours = events.reduce((total, item) => total + eventHours(item), 0);
	const roomHours = totalConventionRoomHours();
	if (totalEventHours < roomHours * MIN_FILL_MULTIPLIER) {
		errors.push(`Only ${totalEventHours} event-hours for ${roomHours} room-hours`);
	}
	if (totalEventHours > roomHours * MAX_FILL_MULTIPLIER) {
		errors.push(`${totalEventHours} event-hours exceeds the ${roomHours} room-hour fit target`);
	}

	const attendanceCounts = events.reduce((counts, item) => {
		counts[item.attendance] = (counts[item.attendance] ?? 0) + 1;
		return counts;
	}, {});

	return { errors, warnings, attendanceCounts, totalEventHours, targetPerRoom };
}

function writeCsv(filePath, rows) {
	const output = Papa.unparse(rows, { newline: '\n' });
	fs.writeFileSync(filePath, `${output}\n`, 'utf8');
}

function sanitizeEventRequiredTags() {
	for (const item of events) {
		item.requiredTags = (item.requiredTags ?? []).filter((tag) => tag === 'main_stage');
	}
}

sanitizeEventRequiredTags();
expandFreeListToFillRooms();
const validation = validateDataset();
if (validation.errors.length > 0) {
	console.error('Synthetic dataset validation failed:');
	for (const error of validation.errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

writeCsv(SUBMISSIONS_PATH, submissionRows());
writeCsv(ROOMS_PATH, roomsRows());

console.log(
	`Wrote ${events.length} synthetic submissions to ${path.relative(process.cwd(), SUBMISSIONS_PATH)}`
);
console.log(`Wrote ${rooms.length} rooms to ${path.relative(process.cwd(), ROOMS_PATH)}`);
console.log(`No scheduled program CSV is written; events remain an unscheduled free list.`);
console.log(
	`Programmable demand: ${validation.totalEventHours} event-hours for ${totalConventionRoomHours()} room-hours`
);
console.log(
	`Estimated attendance distribution: ${Object.entries(validation.attendanceCounts)
		.map(([key, value]) => `${key}=${value}`)
		.join(', ')}`
);
if (validation.warnings.length > 0) {
	console.log(`Warnings: ${validation.warnings.length}`);
}
