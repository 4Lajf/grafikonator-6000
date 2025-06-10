import { supabase } from './supabase.js'
import { handleDatabaseError, withRetry } from './utils/error-handler.js'
import { logger, loggedOperation } from './utils/logger.js'

// Individuals
export async function getIndividuals() {
    return await loggedOperation('getIndividuals', async () => {
        return await withRetry(async () => {
            const { data, error } = await supabase
                .from('individuals')
                .select('*')
                .order('name')

            if (error) throw handleDatabaseError(error)

            logger.database('SELECT', 'individuals', { count: data?.length })
            return data
        })
    })
}

export async function createIndividual(individual) {
    return await loggedOperation('createIndividual', async () => {
        return await withRetry(async () => {
            const { data, error } = await supabase
                .from('individuals')
                .insert([individual])
                .select()
                .single()

            if (error) throw handleDatabaseError(error)

            logger.database('INSERT', 'individuals', { id: data?.id, name: individual.name })
            logger.audit('create_individual', data?.id, { name: individual.name })
            return data
        })
    })
}

export async function updateIndividual(id, updates) {
    const { data, error } = await supabase
        .from('individuals')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
    
    if (error) throw error
    return data
}

export async function deleteIndividual(id) {
    const { error } = await supabase
        .from('individuals')
        .delete()
        .eq('id', id)
    
    if (error) throw error
}

// Departments
export async function getDepartments() {
    return await loggedOperation('getDepartments', async () => {
        return await withRetry(async () => {
            const { data, error } = await supabase
                .from('departments')
                .select('*')
                .order('name')

            if (error) throw handleDatabaseError(error)

            logger.database('SELECT', 'departments', { count: data?.length })
            return data
        })
    })
}

export async function createDepartment(department) {
    return await loggedOperation('createDepartment', async () => {
        return await withRetry(async () => {
            const { data, error } = await supabase
                .from('departments')
                .insert([department])
                .select()
                .single()

            if (error) throw handleDatabaseError(error)

            logger.database('INSERT', 'departments', { id: data?.id, name: department.name })
            logger.audit('create_department', data?.id, { name: department.name })
            return data
        })
    })
}

export async function deleteDepartment(id) {
    return await loggedOperation('deleteDepartment', async () => {
        return await withRetry(async () => {
            // First check if department is used in any schedules
            const { data: schedules, error: scheduleError } = await supabase
                .from('schedules')
                .select('id')
                .eq('department_id', id)
                .limit(1)

            if (scheduleError) throw handleDatabaseError(scheduleError)

            if (schedules && schedules.length > 0) {
                throw new Error('Cannot delete department that has existing schedules')
            }

            const { error } = await supabase
                .from('departments')
                .delete()
                .eq('id', id)

            if (error) throw handleDatabaseError(error)

            logger.database('DELETE', 'departments', { id })
            logger.audit('delete_department', id)
        })
    })
}

// Time Slots
export async function getTimeSlots(date = null) {
    let query = supabase
        .from('time_slots')
        .select('*')
        .eq('is_active', true)

    if (date) {
        query = query.eq('date', date)
    }

    const { data, error } = await query
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })

    if (error) throw error
    return data
}

export async function generateTimeSlotsForDate(date, startHour = 8, endHour = 20) {
    return await loggedOperation('generateTimeSlotsForDate', async () => {
        const slots = []

        // Generate 30-minute slots from startHour to endHour
        for (let hour = startHour; hour < endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`
                const endMinute = minute + 30
                const endHour = endMinute >= 60 ? hour + 1 : hour
                const adjustedEndMinute = endMinute >= 60 ? 0 : endMinute
                const endTime = `${endHour.toString().padStart(2, '0')}:${adjustedEndMinute.toString().padStart(2, '0')}:00`

                slots.push({
                    date,
                    start_time: startTime,
                    end_time: endTime,
                    is_active: true
                })
            }
        }

        // Insert all slots
        const { data, error } = await supabase
            .from('time_slots')
            .upsert(slots, { onConflict: 'date,start_time' })
            .select()

        if (error) throw handleDatabaseError(error)

        logger.database('INSERT', 'time_slots', { date, count: data?.length })
        return data?.length || 0
    })
}

export async function generateTimeSlotsForRange(startDate, endDate, startHour = 8, endHour = 20) {
    return await loggedOperation('generateTimeSlotsForRange', async () => {
        let totalSlots = 0
        const currentDate = new Date(startDate)
        const endDateObj = new Date(endDate)

        while (currentDate <= endDateObj) {
            const dateStr = currentDate.toISOString().split('T')[0]
            const slotsAdded = await generateTimeSlotsForDate(dateStr, startHour, endHour)
            totalSlots += slotsAdded
            currentDate.setDate(currentDate.getDate() + 1)
        }

        logger.database('BULK_INSERT', 'time_slots', {
            startDate,
            endDate,
            totalSlots
        })
        return totalSlots
    })
}

export async function deleteTimeSlot(id) {
    return await loggedOperation('deleteTimeSlot', async () => {
        return await withRetry(async () => {
            // First check if time slot is used in any schedules
            const { data: schedules, error: scheduleError } = await supabase
                .from('schedules')
                .select('id')
                .eq('time_slot_id', id)
                .limit(1)

            if (scheduleError) throw handleDatabaseError(scheduleError)

            if (schedules && schedules.length > 0) {
                throw new Error('Cannot delete time slot that has existing schedules')
            }

            const { error } = await supabase
                .from('time_slots')
                .delete()
                .eq('id', id)

            if (error) throw handleDatabaseError(error)

            logger.database('DELETE', 'time_slots', { id })
            logger.audit('delete_time_slot', id)
        })
    })
}

export async function deleteTimeSlotsForDate(date) {
    return await loggedOperation('deleteTimeSlotsForDate', async () => {
        return await withRetry(async () => {
            // First check if any time slots for this date are used in schedules
            const { data: schedules, error: scheduleError } = await supabase
                .from('schedules')
                .select('id, time_slots!inner(date)')
                .eq('time_slots.date', date)
                .limit(1)

            if (scheduleError) throw handleDatabaseError(scheduleError)

            if (schedules && schedules.length > 0) {
                throw new Error('Cannot delete time slots for a date that has existing schedules')
            }

            const { data, error } = await supabase
                .from('time_slots')
                .delete()
                .eq('date', date)
                .select('id')

            if (error) throw handleDatabaseError(error)

            logger.database('DELETE', 'time_slots', { date, count: data?.length })
            logger.audit('delete_time_slots_for_date', null, { date, count: data?.length })

            return data?.length || 0
        })
    })
}

// Date-specific Availability
export async function getAvailability(individualId = null, startDate = null, endDate = null) {
    return await loggedOperation('getAvailability', async () => {
        return await withRetry(async () => {
            let query = supabase
                .from('availability')
                .select(`
                    *,
                    individuals(name)
                `)

            if (individualId) {
                query = query.eq('individual_id', individualId)
            }

            if (startDate) {
                query = query.gte('date', startDate)
            }

            if (endDate) {
                query = query.lte('date', endDate)
            }

            const { data, error } = await query
                .order('date', { ascending: true })
                .order('start_time', { ascending: true })

            if (error) throw handleDatabaseError(error)

            logger.database('SELECT', 'availability', {
                count: data?.length,
                individualId,
                startDate,
                endDate
            })
            return data
        })
    })
}

export async function setAvailability(individualId, date, startTime, endTime, tier) {
    return await loggedOperation('setAvailability', async () => {
        return await withRetry(async () => {
            const { data, error } = await supabase
                .from('availability')
                .upsert([{
                    individual_id: individualId,
                    date: date,
                    start_time: startTime,
                    end_time: endTime,
                    tier: tier,
                    updated_at: new Date().toISOString()
                }])
                .select()
                .single()

            if (error) throw handleDatabaseError(error)

            logger.database('UPSERT', 'availability', {
                id: data?.id,
                individualId,
                date,
                startTime,
                endTime,
                tier
            })
            logger.audit('set_availability', data?.id, {
                individualId,
                date,
                startTime,
                endTime,
                tier
            })
            return data
        })
    })
}

export async function deleteAvailability(id) {
    return await loggedOperation('deleteAvailability', async () => {
        return await withRetry(async () => {
            const { error } = await supabase
                .from('availability')
                .delete()
                .eq('id', id)

            if (error) throw handleDatabaseError(error)

            logger.database('DELETE', 'availability', { id })
            logger.audit('delete_availability', id)
        })
    })
}

// Get effective availability for a person at a specific time slot
export async function getEffectiveAvailability(individualId, timeSlot) {
    return await loggedOperation('getEffectiveAvailability', async () => {
        return await withRetry(async () => {
            // Check for specific date availability
            const { data: availability } = await supabase
                .from('availability')
                .select('*')
                .eq('individual_id', individualId)
                .eq('date', timeSlot.date)
                .lte('start_time', timeSlot.start_time)
                .gte('end_time', timeSlot.end_time)
                .limit(1)

            if (availability && availability.length > 0) {
                logger.database('SELECT', 'availability', {
                    individualId,
                    date: timeSlot.date,
                    tier: availability[0].tier
                })
                return availability[0].tier
            }

            // Default to not available if no specific availability is set
            logger.database('SELECT', 'availability', {
                individualId,
                date: timeSlot.date,
                tier: 4,
                reason: 'no_availability_set'
            })
            return 4
        })
    })
}

// Schedules
export async function getSchedules(date = null) {
    let query = supabase
        .from('schedules')
        .select(`
            *,
            individuals(name, email),
            departments(name),
            time_slots(date, start_time, end_time)
        `)

    if (date) {
        query = query.eq('time_slots.date', date)
    }

    const { data, error } = await query
        .order('time_slots.date', { ascending: true })
        .order('time_slots.start_time', { ascending: true })

    if (error) throw error
    return data
}

export async function createSchedule(schedule) {
    const { data, error } = await supabase
        .from('schedules')
        .insert([schedule])
        .select(`
            *,
            individuals(name, email),
            departments(name),
            time_slots(date, start_time, end_time)
        `)
        .single()

    if (error) throw error
    return data
}

export async function updateSchedule(id, updates) {
    const { data, error } = await supabase
        .from('schedules')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(`
            *,
            individuals(name, email),
            departments(name),
            time_slots(date, start_time, end_time)
        `)
        .single()

    if (error) throw error
    return data
}

export async function deleteSchedule(id) {
    const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', id)
    
    if (error) throw error
}

// Auto-scheduling logic
export async function autoSchedule(departmentId, timeSlotId) {
    // Get the time slot details
    const { data: timeSlot, error: timeSlotError } = await supabase
        .from('time_slots')
        .select('*')
        .eq('id', timeSlotId)
        .single()

    if (timeSlotError) throw timeSlotError

    // Get all individuals
    const { data: individuals, error: individualsError } = await supabase
        .from('individuals')
        .select('*')

    if (individualsError) throw individualsError

    // Get existing schedules for this time slot
    const { data: existingSchedules } = await supabase
        .from('schedules')
        .select('individual_id')
        .eq('time_slot_id', timeSlotId)

    const scheduledIndividualIds = new Set(existingSchedules?.map(s => s.individual_id) || [])

    // Find the best available person
    let bestPerson = null
    let bestTier = 5 // Start with worse than tier 4

    for (const individual of individuals) {
        if (scheduledIndividualIds.has(individual.id)) continue

        const tier = await getEffectiveAvailability(individual.id, timeSlot)

        if (tier < 4 && tier < bestTier) {
            bestPerson = individual
            bestTier = tier
        }
    }

    if (!bestPerson) {
        throw new Error('No available person found for this time slot')
    }

    // Create the schedule
    return await createSchedule({
        individual_id: bestPerson.id,
        department_id: departmentId,
        time_slot_id: timeSlotId,
        status: 'scheduled'
    })
}
