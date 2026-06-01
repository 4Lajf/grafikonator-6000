import { describe, expect, it } from 'vitest';
import {
	PLAN_FORMAT,
	PLAN_VERSION,
	buildPlanFilename,
	describePlan,
	parsePlanJson,
	serializePlan
} from './plan-io.js';

const sampleState = {
	conventions: [
		{
			id: 'conv-1',
			name: 'TestCon 2026',
			start_date: '2026-05-15',
			end_date: '2026-05-17'
		}
	],
	people: [{ id: 'p1', convention_id: 'conv-1', display_name: 'Alice' }],
	rooms: [{ id: 'r1', convention_id: 'conv-1', name: 'Sala A' }],
	events: [{ id: 'e1', convention_id: 'conv-1', title: 'Panel RPG' }],
	event_hosts: [{ event_id: 'e1', person_id: 'p1' }],
	time_slots: [{ id: 's1', convention_id: 'conv-1', date: '2026-05-15' }],
	availability: [{ id: 'a1', person_id: 'p1', time_slot_id: 's1', tier: 1 }],
	schedules: [{ id: 'sch1', event_id: 'e1', room_id: 'r1', start_time_slot_id: 's1' }],
	import_value_mappings: []
};

describe('plan-io', () => {
	it('serializes the full local state envelope', () => {
		const envelope = serializePlan(sampleState, { conventionName: 'TestCon 2026' });

		expect(envelope.format).toBe(PLAN_FORMAT);
		expect(envelope.version).toBe(PLAN_VERSION);
		expect(envelope.conventionName).toBe('TestCon 2026');
		expect(envelope.data.people).toHaveLength(1);
		expect(envelope.data.schedules).toHaveLength(1);
	});

	it('round-trips through JSON', () => {
		const json = JSON.stringify(serializePlan(sampleState));
		const data = parsePlanJson(json);

		expect(data.conventions[0].name).toBe('TestCon 2026');
		expect(data.schedules).toHaveLength(1);
	});

	it('accepts legacy raw state objects', () => {
		const data = parsePlanJson(JSON.stringify(sampleState));
		expect(data.events).toHaveLength(1);
	});

	it('describes imported plans', () => {
		const summary = describePlan(sampleState);
		expect(summary).toEqual({
			conventionName: 'TestCon 2026',
			peopleCount: 1,
			eventCount: 1,
			scheduleCount: 1,
			conventionCount: 1
		});
	});

	it('builds a safe download filename', () => {
		expect(buildPlanFilename('Foo Bar 2026!')).toMatch(/^foo-bar-2026-\d{4}-\d{2}-\d{2}\.json$/);
	});

	it('rejects invalid files', () => {
		expect(() => parsePlanJson('')).toThrow(/pusty/i);
		expect(() => parsePlanJson('{')).toThrow(/JSON/i);
		expect(() => parsePlanJson('{"foo":1}')).toThrow(/formatu/i);
		expect(() => parsePlanJson('{"format":"grafikonator-6000-plan","version":1,"data":{"conventions":[]}}')).toThrow(
			/konwentu/i
		);
	});
});
