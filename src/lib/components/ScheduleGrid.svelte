<script>
    import { onMount } from 'svelte'
    import { draggable } from '@neodrag/svelte'
    import { getDepartments, getTimeSlots, getSchedules, getIndividuals, createSchedule, updateSchedule, deleteSchedule, autoSchedule, autoScheduleAll, generateTimeSlotsForDate, getAvailability, batchCreateSchedules, batchDeleteSchedules } from '$lib/database.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import * as Select from '$lib/components/ui/select/index.js'
    import * as AlertDialog from '$lib/components/ui/alert-dialog'
    import * as Sheet from '$lib/components/ui/sheet'
    import * as Popover from '$lib/components/ui/popover'
    import { Calendar } from '$lib/components/ui/calendar'
    import { toast } from 'svelte-sonner'
    import CalendarIcon from "@lucide/svelte/icons/calendar"
    import { AlertTriangle } from 'lucide-svelte'
    import { DateFormatter, getLocalTimeZone, parseDate } from "@internationalized/date"

    let departments = []
    let timeSlots = []
    let schedules = []
    let individuals = []
    let selectedDate = new Date().toISOString().split('T')[0]
    let loading = false
    let draggedSchedule = null
    let generatingSlots = false
    let autoSchedulingAll = false
    let refreshing = false
    let isUpdatingLocally = false // Flag to prevent reactive reloads during local updates
    let autoScheduleProgress = 0 // Progress percentage for bulk auto-scheduling
    let searchQueries = {} // Store search queries for each select dropdown
    let showUnscheduleDialog = false
    let unschedulingAll = false
    let showIssuesDrawer = false
    let scheduleIssues = []
    let datePickerOpen = false
    let availabilityCache = new Map() // Cache for individual availability tiers
    let loadingAvailability = false

    // Date picker setup
    const df = new DateFormatter("en-US", {
        dateStyle: "long",
    })

    // Convert selectedDate to DateValue for the calendar
    $: dateValue = selectedDate ? parseDate(selectedDate) : undefined

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    // Tier color system (red for tier 4 and conflicts)
    const tierColors = {
        1: 'bg-green-100 border-green-300 text-green-900', // Highly Available
        2: 'bg-yellow-100 border-yellow-300 text-yellow-900', // Available When Needed
        3: 'bg-orange-100 border-orange-300 text-orange-900', // Only If Exhausted
        4: 'bg-red-100 border-red-300 text-red-900' // Not Available (red for incorrect matches)
    }

    const conflictColor = 'bg-red-200 border-red-400 text-red-900' // For scheduling conflicts

    // Rate limiting configuration for auto-schedule-all
    const RATE_LIMIT_CONFIG = {
        BATCH_SIZE: 3, // Number of slots to process simultaneously
        DELAY_BETWEEN_BATCHES: 1000, // Milliseconds between batches
        REFRESH_DELAY_INDIVIDUAL: 500, // Delay before refresh after individual auto-schedule
        REFRESH_DELAY_BULK: 1000 // Delay before refresh after bulk auto-schedule
    }

    onMount(async () => {
        await loadData()
        await loadSchedules()
        await loadAvailabilityForTimeSlots()
    })

    async function loadData() {
        loading = true
        try {
            departments = await getDepartments()
            individuals = await getIndividuals()
            await loadTimeSlots()
            await loadAvailabilityForTimeSlots()
        } catch (error) {
            console.error('Error loading data:', error)
            toast.error('Failed to load data', {
                description: 'Please try again.'
            })
        } finally {
            loading = false
        }
    }

    async function loadTimeSlots() {
        try {
            timeSlots = await getTimeSlots(selectedDate)
        } catch (error) {
            console.error('Error loading time slots:', error)
            toast.error('Failed to load time slots', {
                description: 'Please try again.'
            })
        }
    }

    async function loadSchedules() {
        try {
            schedules = await getSchedules(selectedDate)
        } catch (error) {
            console.error('Error loading schedules:', error)
            toast.error('Failed to load schedules', {
                description: 'Please try again.'
            })
        }
    }

    async function handleGenerateTimeSlots() {
        generatingSlots = true
        try {
            const count = await generateTimeSlotsForDate(selectedDate, 8, 20) // 8 AM to 8 PM
            toast.success('Time slots generated!', {
                description: `Generated ${count} time slots for ${selectedDate}.`
            })
            // Real-time update: reload time slots to show the new ones immediately
            const newTimeSlots = await getTimeSlots(selectedDate)
            timeSlots = newTimeSlots
        } catch (error) {
            console.error('Error generating time slots:', error)
            toast.error('Failed to generate time slots', {
                description: error.message
            })
        } finally {
            generatingSlots = false
        }
    }

    function getScheduleForSlot(departmentId, timeSlotId) {
        return schedules.find(s =>
            s.department_id === departmentId &&
            s.time_slot_id === timeSlotId
        )
    }

    // Real-time conflict detection - check if person is already scheduled at this time
    function hasConflict(individualId, timeSlotId, excludeScheduleId = null) {
        return schedules.some(s =>
            s.individual_id === individualId &&
            s.time_slot_id === timeSlotId &&
            s.id !== excludeScheduleId
        )
    }

    function isSlotOccupied(departmentId, timeSlotId, excludeScheduleId = null) {
        return schedules.some(s =>
            s.department_id === departmentId &&
            s.time_slot_id === timeSlotId &&
            s.id !== excludeScheduleId
        )
    }

    async function handleAutoSchedule(departmentId, timeSlotId) {
        try {
            isUpdatingLocally = true // Prevent reactive reload

            // Perform local auto-scheduling calculation
            const result = await performLocalAutoSchedule(departmentId, timeSlotId)

            if (result.success) {
                const schedule = await createSchedule({
                    individual_id: result.individualId,
                    department_id: departmentId,
                    time_slot_id: timeSlotId,
                    status: 'scheduled'
                })

                toast.success('Auto-scheduled successfully!', {
                    description: `Assigned ${result.individualName} to ${result.departmentName}.`
                })

                // Real-time update: add the new schedule to the local array
                schedules = [...schedules, schedule]

                // Trigger silent refresh to ensure data consistency
                setTimeout(async () => {
                    await handleRefresh(true) // Silent refresh
                }, RATE_LIMIT_CONFIG.REFRESH_DELAY_INDIVIDUAL)
            } else {
                toast.error('Auto-scheduling failed', {
                    description: result.error
                })
            }
        } catch (error) {
            console.error('Auto-scheduling failed:', error)
            toast.error('Auto-scheduling failed', {
                description: error.message
            })
        } finally {
            isUpdatingLocally = false
        }
    }

    // Filter individuals based on search query
    function getFilteredIndividuals(searchKey) {
        const query = searchQueries[searchKey] || ''
        if (!query.trim()) {
            return individuals
        }

        const searchTerm = query.toLowerCase().trim()
        return individuals.filter(individual =>
            individual.name.toLowerCase().includes(searchTerm) ||
            (individual.email && individual.email.toLowerCase().includes(searchTerm))
        )
    }

    // Generate unique search key for each select dropdown
    function getSearchKey(departmentId, timeSlotId) {
        const key = `${departmentId}-${timeSlotId}`
        // Initialize search query if it doesn't exist
        if (!(key in searchQueries)) {
            searchQueries[key] = ''
        }
        return key
    }

    // Optimal auto-scheduling logic - considers availability tiers and workload balance
    // Benefits: Much faster, reduces server load, works with current local state, respects availability tiers
    async function performLocalAutoSchedule(departmentId, timeSlotId) {
        try {
            // Find the time slot details from local data
            const timeSlot = timeSlots.find(ts => ts.id === timeSlotId)
            if (!timeSlot) {
                return { success: false, error: 'Time slot not found' }
            }

            // Find department name
            const department = departments.find(d => d.id === departmentId)
            const departmentName = department?.name || 'Unknown Department'

            // Get all individuals who are already scheduled at this time slot
            const scheduledIndividualIds = new Set(
                schedules
                    .filter(s => s.time_slot_id === timeSlotId)
                    .map(s => s.individual_id)
            )

            // Find available individuals (not already scheduled at this time)
            const availableIndividuals = individuals.filter(individual =>
                !scheduledIndividualIds.has(individual.id)
            )

            if (availableIndividuals.length === 0) {
                return { success: false, error: 'No available individuals for this time slot' }
            }

            // Get availability tiers for all available individuals
            const individualsWithTiers = availableIndividuals.map(individual => {
                const cacheKey = `${individual.id}-${timeSlotId}`
                const tier = availabilityCache.get(cacheKey) || 4 // Default to not available if not cached
                const assignmentCount = schedules.filter(s => s.individual_id === individual.id).length

                return {
                    individual,
                    tier,
                    assignmentCount
                }
            })

            // Filter out tier 4 (not available) individuals
            const schedulableIndividuals = individualsWithTiers.filter(item => item.tier < 4)

            if (schedulableIndividuals.length === 0) {
                return { success: false, error: 'No available individuals for this time slot (all are tier 4 - not available)' }
            }

            // Sort by tier first (ascending - prefer lower tiers), then by assignment count (ascending - balance workload)
            schedulableIndividuals.sort((a, b) => {
                if (a.tier !== b.tier) {
                    return a.tier - b.tier // Prefer lower tier numbers (1 is better than 2)
                }
                return a.assignmentCount - b.assignmentCount // Balance workload
            })

            const selectedItem = schedulableIndividuals[0]
            const tierInfo = selectedItem.tier === 3 ? ' (Warning: Tier 3 - only if exhausted)' : ''

            return {
                success: true,
                individualId: selectedItem.individual.id,
                individualName: selectedItem.individual.name,
                departmentName: departmentName,
                tier: selectedItem.tier,
                warning: selectedItem.tier === 3 ? 'Tier 3 assignment - consider if other options are truly exhausted' : null
            }
        } catch (error) {
            console.error('Local auto-scheduling calculation failed:', error)
            return { success: false, error: error.message }
        }
    }

    // Calculate optimal assignments for all empty slots using local data
    async function calculateOptimalAssignments(emptySlots) {
        const assignments = []
        const assignmentCounts = new Map() // Track assignments per individual for workload balancing
        const usedIndividuals = new Set() // Track individuals already assigned in this batch

        // Initialize assignment counts
        individuals.forEach(individual => {
            const currentCount = schedules.filter(s => s.individual_id === individual.id).length
            assignmentCounts.set(individual.id, currentCount)
        })

        // Sort empty slots by time slot to process chronologically
        const sortedSlots = [...emptySlots].sort((a, b) => {
            const timeA = a.timeSlot.start_time
            const timeB = b.timeSlot.start_time
            return timeA.localeCompare(timeB)
        })

        let processedSlots = 0
        for (const slot of sortedSlots) {
            // Get all individuals who are not already scheduled at this time slot
            const scheduledAtThisTime = new Set(
                schedules
                    .filter(s => s.time_slot_id === slot.timeSlotId)
                    .map(s => s.individual_id)
            )

            // Add individuals from current batch assignments
            assignments
                .filter(a => a.timeSlotId === slot.timeSlotId)
                .forEach(a => scheduledAtThisTime.add(a.individualId))

            const availableIndividuals = individuals.filter(individual =>
                !scheduledAtThisTime.has(individual.id)
            )

            if (availableIndividuals.length === 0) {
                console.warn(`No available individuals for ${slot.departmentName} at ${slot.timeSlotTime}`)
                continue
            }

            // Get availability tiers and assignment counts for available individuals
            const candidatesWithTiers = availableIndividuals.map(individual => {
                const cacheKey = `${individual.id}-${slot.timeSlotId}`
                const tier = availabilityCache.get(cacheKey) || 4
                const assignmentCount = assignmentCounts.get(individual.id) || 0

                return {
                    individual,
                    tier,
                    assignmentCount
                }
            })

            // Filter out tier 4 (not available) individuals
            const schedulableCandidates = candidatesWithTiers.filter(candidate => candidate.tier < 4)

            if (schedulableCandidates.length === 0) {
                console.warn(`No schedulable individuals for ${slot.departmentName} at ${slot.timeSlotTime} (all are tier 4)`)
                continue
            }

            // Sort by tier first (ascending - prefer lower tiers), then by assignment count (ascending - balance workload)
            schedulableCandidates.sort((a, b) => {
                if (a.tier !== b.tier) {
                    return a.tier - b.tier // Prefer lower tier numbers (1 is better than 2)
                }
                return a.assignmentCount - b.assignmentCount // Balance workload
            })

            const selectedCandidate = schedulableCandidates[0]

            // Create assignment
            assignments.push({
                individualId: selectedCandidate.individual.id,
                individualName: selectedCandidate.individual.name,
                departmentId: slot.departmentId,
                departmentName: slot.departmentName,
                timeSlotId: slot.timeSlotId,
                timeSlotTime: slot.timeSlotTime,
                tier: selectedCandidate.tier,
                warning: selectedCandidate.tier === 3 ? 'Tier 3 assignment - only if exhausted' : null
            })

            // Update assignment count for workload balancing in subsequent iterations
            assignmentCounts.set(selectedCandidate.individual.id, selectedCandidate.assignmentCount + 1)

            // Update progress during calculation (15% to 25%)
            processedSlots++
            const calculationProgress = Math.round(15 + (processedSlots / sortedSlots.length) * 10)
            autoScheduleProgress = calculationProgress
        }

        console.log(`Calculated ${assignments.length} optimal assignments out of ${emptySlots.length} empty slots`)
        return assignments
    }

    // Batch create schedules in the database with optimal performance
    async function batchCreateSchedulesLocal(assignments) {
        const results = []

        // Filter out assignments that would cause conflicts
        const validAssignments = []
        const invalidAssignments = []

        for (const assignment of assignments) {
            // Final check: ensure the slot is still empty and person is still available
            const existingSchedule = getScheduleForSlot(assignment.departmentId, assignment.timeSlotId)
            if (existingSchedule) {
                invalidAssignments.push({
                    success: false,
                    error: 'Slot already filled',
                    assignment
                })
                continue
            }

            const hasExistingConflict = hasConflict(assignment.individualId, assignment.timeSlotId)
            if (hasExistingConflict) {
                invalidAssignments.push({
                    success: false,
                    error: 'Person already scheduled at this time',
                    assignment
                })
                continue
            }

            validAssignments.push(assignment)
        }

        // Add invalid assignments to results
        results.push(...invalidAssignments)

        if (validAssignments.length === 0) {
            return results
        }

        // Process valid assignments in batches using the new batch create function
        const batchSize = RATE_LIMIT_CONFIG.BATCH_SIZE

        for (let i = 0; i < validAssignments.length; i += batchSize) {
            const batch = validAssignments.slice(i, i + batchSize)

            try {
                // Convert assignments to schedule objects
                const scheduleObjects = batch.map(assignment => ({
                    individual_id: assignment.individualId,
                    department_id: assignment.departmentId,
                    time_slot_id: assignment.timeSlotId,
                    status: 'scheduled'
                }))

                // Use the new batch create function from database.js
                const createdSchedules = await batchCreateSchedules(scheduleObjects)

                // Map results back to assignments
                batch.forEach((assignment, index) => {
                    const schedule = createdSchedules[index]
                    if (schedule) {
                        results.push({
                            success: true,
                            schedule,
                            assignment,
                            warning: assignment.warning
                        })
                    } else {
                        results.push({
                            success: false,
                            error: 'Failed to create schedule',
                            assignment
                        })
                    }
                })

            } catch (error) {
                console.error(`Failed to batch create schedules:`, error)

                // Mark all assignments in this batch as failed
                batch.forEach(assignment => {
                    results.push({
                        success: false,
                        error: error.message,
                        assignment
                    })
                })
            }

            // Add delay between batches (except for the last batch)
            if (i + batchSize < validAssignments.length) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.DELAY_BETWEEN_BATCHES))
            }
        }

        return results
    }

    // Batch create schedules with progress tracking
    async function batchCreateSchedulesLocalWithProgress(assignments, totalEmptySlots) {
        const results = []

        // Filter out assignments that would cause conflicts
        const validAssignments = []
        const invalidAssignments = []

        for (const assignment of assignments) {
            // Final check: ensure the slot is still empty and person is still available
            const existingSchedule = getScheduleForSlot(assignment.departmentId, assignment.timeSlotId)
            if (existingSchedule) {
                invalidAssignments.push({
                    success: false,
                    error: 'Slot already filled',
                    assignment
                })
                continue
            }

            const hasExistingConflict = hasConflict(assignment.individualId, assignment.timeSlotId)
            if (hasExistingConflict) {
                invalidAssignments.push({
                    success: false,
                    error: 'Person already scheduled at this time',
                    assignment
                })
                continue
            }

            validAssignments.push(assignment)
        }

        // Add invalid assignments to results
        results.push(...invalidAssignments)

        if (validAssignments.length === 0) {
            return results
        }

        // Process valid assignments in batches with progress tracking
        const batchSize = RATE_LIMIT_CONFIG.BATCH_SIZE
        let processedCount = 0

        for (let i = 0; i < validAssignments.length; i += batchSize) {
            const batch = validAssignments.slice(i, i + batchSize)

            try {
                // Convert assignments to schedule objects
                const scheduleObjects = batch.map(assignment => ({
                    individual_id: assignment.individualId,
                    department_id: assignment.departmentId,
                    time_slot_id: assignment.timeSlotId,
                    status: 'scheduled'
                }))

                // Use the new batch create function from database.js
                const createdSchedules = await batchCreateSchedules(scheduleObjects)

                // Map results back to assignments
                batch.forEach((assignment, index) => {
                    const schedule = createdSchedules[index]
                    if (schedule) {
                        results.push({
                            success: true,
                            schedule,
                            assignment,
                            warning: assignment.warning
                        })
                    } else {
                        results.push({
                            success: false,
                            error: 'Failed to create schedule',
                            assignment
                        })
                    }
                })

                // Update progress based on actual work completed
                processedCount += batch.length
                const progressPercent = Math.round(25 + (processedCount / validAssignments.length) * 70) // 25% to 95%
                autoScheduleProgress = Math.min(progressPercent, 95)

            } catch (error) {
                console.error(`Failed to batch create schedules:`, error)

                // Mark all assignments in this batch as failed
                batch.forEach(assignment => {
                    results.push({
                        success: false,
                        error: error.message,
                        assignment
                    })
                })

                // Still update progress even for failed batches
                processedCount += batch.length
                const progressPercent = Math.round(25 + (processedCount / validAssignments.length) * 70)
                autoScheduleProgress = Math.min(progressPercent, 95)
            }

            // Add delay between batches (except for the last batch)
            if (i + batchSize < validAssignments.length) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.DELAY_BETWEEN_BATCHES))
            }
        }

        return results
    }

    async function handleAutoScheduleAll() {
        autoSchedulingAll = true
        isUpdatingLocally = true
        autoScheduleProgress = 0

        try {
            // Step 1: Download all required data once
            console.log('Downloading all required data for optimal scheduling...')
            autoScheduleProgress = 5

            // First, refresh schedules to ensure we have the latest data
            await loadSchedules()
            autoScheduleProgress = 10

            // Get all empty slots that need to be filled
            const emptySlots = []
            for (const timeSlot of timeSlots) {
                for (const department of departments) {
                    const existingSchedule = getScheduleForSlot(department.id, timeSlot.id)
                    if (!existingSchedule) {
                        emptySlots.push({
                            departmentId: department.id,
                            timeSlotId: timeSlot.id,
                            departmentName: department.name,
                            timeSlotTime: `${formatTime(timeSlot.start_time)} - ${formatTime(timeSlot.end_time)}`,
                            timeSlot: timeSlot
                        })
                    }
                }
            }

            if (emptySlots.length === 0) {
                toast.info('No empty slots to fill', {
                    description: 'All time slots are already assigned.'
                })
                return
            }

            console.log(`Found ${emptySlots.length} empty slots to fill`)
            autoScheduleProgress = 15

            // Step 2: Perform optimal local calculations
            console.log('Calculating optimal assignments...')
            const optimalAssignments = await calculateOptimalAssignments(emptySlots)
            autoScheduleProgress = 25

            if (optimalAssignments.length === 0) {
                toast.warning('No optimal assignments found', {
                    description: 'No suitable individuals were found for the available slots.'
                })
                return
            }

            // Step 3: Batch create all schedules in the database with progress tracking
            console.log(`Creating ${optimalAssignments.length} optimal assignments...`)
            const results = await batchCreateSchedulesLocalWithProgress(optimalAssignments, emptySlots.length)

            // Step 4: Update local state with successful assignments
            const successfulSchedules = results.filter(r => r.success).map(r => r.schedule)
            schedules = [...schedules, ...successfulSchedules]

            const successCount = results.filter(r => r.success).length
            const errorCount = results.filter(r => !r.success).length
            const warningCount = results.filter(r => r.success && r.warning).length

            // Step 5: Show results and refresh
            autoScheduleProgress = 100

            if (successCount > 0) {
                let description = `Successfully scheduled ${successCount} slots.`
                if (errorCount > 0) {
                    description += ` ${errorCount} slots could not be filled.`
                }
                if (warningCount > 0) {
                    description += ` ${warningCount} assignments use tier 3 individuals (only if exhausted).`
                }

                toast.success('Auto-scheduling completed!', { description })

                // Trigger silent refresh to ensure data consistency
                setTimeout(async () => {
                    await handleRefresh(true) // Silent refresh
                }, RATE_LIMIT_CONFIG.REFRESH_DELAY_BULK)
            } else {
                toast.warning('No slots were scheduled', {
                    description: 'No suitable individuals were found for the available slots.'
                })
            }

        } catch (error) {
            console.error('Auto-scheduling failed:', error)
            toast.error('Auto-scheduling failed', {
                description: error.message
            })
        } finally {
            autoSchedulingAll = false
            isUpdatingLocally = false
            autoScheduleProgress = 0
        }
    }

    async function handleDeleteSchedule(scheduleId) {
        const schedule = schedules.find(s => s.id === scheduleId)
        const individualName = schedule?.individuals?.name || 'Unknown'
        const departmentName = schedule?.departments?.name || 'Unknown'

        if (!confirm(`Are you sure you want to remove ${individualName} from ${departmentName}?`)) return

        try {
            isUpdatingLocally = true // Prevent reactive reload
            await deleteSchedule(scheduleId)
            toast.success('Schedule deleted!', {
                description: `Removed ${individualName} from ${departmentName}.`
            })
            // Real-time update: remove the schedule from the local array
            schedules = schedules.filter(s => s.id !== scheduleId)

            // Trigger silent refresh to ensure data consistency
            setTimeout(async () => {
                await handleRefresh(true) // Silent refresh
            }, RATE_LIMIT_CONFIG.REFRESH_DELAY_INDIVIDUAL)
        } catch (error) {
            console.error('Error deleting schedule:', error)
            toast.error('Failed to delete schedule', {
                description: 'Please try again.'
            })
        } finally {
            isUpdatingLocally = false
        }
    }

    function handleDragStart(schedule) {
        draggedSchedule = schedule
    }

    async function handleDrop(event, departmentId, timeSlotId) {
        event.preventDefault()
        
        if (!draggedSchedule) return
        
        // Check if there's already a schedule in this slot
        if (isSlotOccupied(departmentId, timeSlotId, draggedSchedule.id)) {
            toast.error('Slot already occupied', {
                description: 'This time slot is already assigned to someone else.'
            })
            return
        }

        // Check if the person is already scheduled at this time in another department
        if (hasConflict(draggedSchedule.individual_id, timeSlotId, draggedSchedule.id)) {
            toast.error('Scheduling conflict', {
                description: 'This person is already scheduled at this time in another department.'
            })
            return
        }

        try {
            isUpdatingLocally = true // Prevent reactive reload
            const updatedSchedule = await updateSchedule(draggedSchedule.id, {
                department_id: departmentId,
                time_slot_id: timeSlotId
            })
            const departmentName = departments.find(d => d.id === departmentId)?.name || 'Unknown'
            toast.success('Schedule moved!', {
                description: `Moved ${draggedSchedule.individuals?.name} to ${departmentName}.`
            })
            // Real-time update: update the schedule in the local array
            schedules = schedules.map(s => s.id === draggedSchedule.id ? updatedSchedule : s)

            // Trigger silent refresh to ensure data consistency
            setTimeout(async () => {
                await handleRefresh(true) // Silent refresh
            }, RATE_LIMIT_CONFIG.REFRESH_DELAY_INDIVIDUAL)
        } catch (error) {
            console.error('Error updating schedule:', error)
            toast.error('Failed to move schedule', {
                description: error.message
            })
        } finally {
            isUpdatingLocally = false
        }

        draggedSchedule = null
    }

    function handleDragOver(event) {
        event.preventDefault()
    }

    async function handleManualSchedule(individualId, departmentId, timeSlotId) {
        console.log('handleManualSchedule called with:', { individualId, departmentId, timeSlotId }) // Debug log

        // Check if there's already a schedule in this slot
        if (isSlotOccupied(departmentId, timeSlotId)) {
            toast.error('Slot already occupied', {
                description: 'This time slot is already assigned to someone else.'
            })
            return
        }

        // Check if the person is already scheduled at this time in another department
        if (hasConflict(individualId, timeSlotId)) {
            toast.error('Scheduling conflict', {
                description: 'This person is already scheduled at this time in another department.'
            })
            return
        }

        try {
            isUpdatingLocally = true // Prevent reactive reload
            const schedule = await createSchedule({
                individual_id: individualId,
                department_id: departmentId,
                time_slot_id: timeSlotId,
                status: 'scheduled'
            })

            const individual = individuals.find(i => i.id === individualId)
            const department = departments.find(d => d.id === departmentId)

            toast.success('Schedule created!', {
                description: `Assigned ${individual?.name} to ${department?.name}.`
            })

            // Real-time update: add the new schedule to the local array
            schedules = [...schedules, schedule]

            // Trigger silent refresh to ensure data consistency
            setTimeout(async () => {
                await handleRefresh(true) // Silent refresh
            }, RATE_LIMIT_CONFIG.REFRESH_DELAY_INDIVIDUAL)
        } catch (error) {
            console.error('Error creating schedule:', error)
            toast.error('Failed to create schedule', {
                description: error.message
            })
        } finally {
            isUpdatingLocally = false
        }
    }

    async function handleRefresh(silent = false) {
        refreshing = true
        try {
            await loadTimeSlots()
            await loadAvailabilityForTimeSlots()
            await loadSchedules()
            if (!silent) {
                toast.success('Data refreshed!', {
                    description: 'Schedule data has been updated.'
                })
            }
        } catch (error) {
            console.error('Error refreshing data:', error)
            if (!silent) {
                toast.error('Failed to refresh data', {
                    description: 'Please try again.'
                })
            }
        } finally {
            refreshing = false
        }
    }

    async function handleUnscheduleAll() {
        unschedulingAll = true
        try {
            // Get all schedules for the selected date
            const schedulesToDelete = schedules.filter(schedule => {
                const timeSlot = timeSlots.find(ts => ts.id === schedule.time_slot_id)
                return timeSlot && timeSlot.date === selectedDate
            })

            if (schedulesToDelete.length === 0) {
                toast.info('No schedules to remove', {
                    description: 'There are no scheduled assignments for this date.'
                })
                return
            }

            // Extract schedule IDs for batch deletion
            const scheduleIds = schedulesToDelete.map(schedule => schedule.id)

            // Batch delete all schedules
            const result = await batchDeleteSchedules(scheduleIds)

            // Update local state - remove deleted schedules
            schedules = schedules.filter(s => !scheduleIds.includes(s.id))

            showUnscheduleDialog = false
            toast.success('All schedules cleared!', {
                description: `Removed ${result.count} scheduled assignments for ${selectedDate}.`
            })

        } catch (error) {
            console.error('Error unscheduling all:', error)
            toast.error('Failed to clear schedules', {
                description: 'Please try again.'
            })
        } finally {
            unschedulingAll = false
        }
    }

    // Detect schedule issues
    function detectScheduleIssues() {
        const issues = []

        // Create a comprehensive map to detect all types of conflicts
        const personTimeSlotMap = new Map() // Map: "person-timeslot" -> array of schedules

        // Group schedules by person and time slot
        schedules.forEach(schedule => {
            const key = `${schedule.individual_id}-${schedule.time_slot_id}`
            if (!personTimeSlotMap.has(key)) {
                personTimeSlotMap.set(key, [])
            }
            personTimeSlotMap.get(key).push(schedule)
        })

        // Check for conflicts (same person in multiple departments at same time)
        personTimeSlotMap.forEach((schedulesForPersonTime, key) => {
            if (schedulesForPersonTime.length > 1) {
                // This person is scheduled in multiple departments at the same time
                const timeSlot = timeSlots.find(ts => ts.id === schedulesForPersonTime[0].time_slot_id)
                const individual = individuals.find(i => i.id === schedulesForPersonTime[0].individual_id)
                const departmentNames = schedulesForPersonTime.map(s => {
                    const dept = departments.find(d => d.id === s.department_id)
                    return dept?.name || 'Unknown Department'
                })

                issues.push({
                    type: 'conflict',
                    message: `${individual?.name} is scheduled in multiple departments: ${departmentNames.join(', ')}`,
                    timeSlot: timeSlot ? `${formatTime(timeSlot.start_time)} - ${formatTime(timeSlot.end_time)}` : 'Unknown time',
                    severity: 'critical',
                    scheduleIds: schedulesForPersonTime.map(s => s.id),
                    departmentCount: schedulesForPersonTime.length
                })
            }
        })

        // Check for tier 3 and tier 4 individuals who are scheduled
        schedules.forEach(schedule => {
            const cacheKey = `${schedule.individual_id}-${schedule.time_slot_id}`
            const tier = availabilityCache.get(cacheKey)

            const timeSlot = timeSlots.find(ts => ts.id === schedule.time_slot_id)
            const individual = individuals.find(i => i.id === schedule.individual_id)
            const department = departments.find(d => d.id === schedule.department_id)

            if (tier === 4) {
                // Tier 4: Absolutely cannot be there (critical issue)
                issues.push({
                    type: 'unavailable',
                    message: `${individual?.name} is physically not available and cannot be scheduled in ${department?.name}`,
                    timeSlot: timeSlot ? `${formatTime(timeSlot.start_time)} - ${formatTime(timeSlot.end_time)}` : 'Unknown time',
                    severity: 'critical',
                    scheduleId: schedule.id,
                    tier: tier
                })
            } else if (tier === 3) {
                // Tier 3: Only if exhausted (warning - may need availability change)
                issues.push({
                    type: 'suboptimal',
                    message: `${individual?.name} is scheduled but only available if all other options are exhausted`,
                    timeSlot: timeSlot ? `${formatTime(timeSlot.start_time)} - ${formatTime(timeSlot.end_time)}` : 'Unknown time',
                    severity: 'warning',
                    scheduleId: schedule.id,
                    tier: tier
                })
            }
        })



        return issues
    }

    // Get tier color for a schedule
    function getScheduleColor(schedule) {
        // If availability is loading, show a neutral loading state
        if (loadingAvailability) {
            return 'bg-gray-100 border-gray-300 text-gray-700 animate-pulse'
        }

        // Check if this schedule has conflicts (red for incorrect matches)
        const hasScheduleConflict = hasConflict(schedule.individual_id, schedule.time_slot_id, schedule.id)
        if (hasScheduleConflict) {
            return conflictColor
        }

        // Get the availability tier from cache
        const cacheKey = `${schedule.individual_id}-${schedule.time_slot_id}`
        const tier = availabilityCache.get(cacheKey) || 4 // Default to not available if not cached

        // Red color is used for both tier 4 (not available) and conflicts
        return tierColors[tier] || tierColors[4] // Default to red if tier not found
    }

    // Load availability for all individuals for the current time slots in a single batch
    async function loadAvailabilityForTimeSlots() {
        if (!timeSlots.length || !individuals.length || !selectedDate) return

        loadingAvailability = true
        try {
            // Clear existing cache
            availabilityCache.clear()

            // Fetch all availability data for the selected date in one query
            const availabilityData = await getAvailability(null, selectedDate, selectedDate)

            // Create a helper function to check if a time slot overlaps with availability
            function isTimeSlotCovered(timeSlot, availability) {
                return availability.start_time <= timeSlot.start_time &&
                       availability.end_time >= timeSlot.end_time
            }

            // Process each individual and time slot combination
            for (const individual of individuals) {
                for (const timeSlot of timeSlots) {
                    // Find the best matching availability for this individual and time slot
                    const matchingAvailability = availabilityData.find(avail =>
                        avail.individual_id === individual.id &&
                        isTimeSlotCovered(timeSlot, avail)
                    )

                    // Use the tier from matching availability, or default to 4 (not available)
                    const tier = matchingAvailability ? matchingAvailability.tier : 4

                    const cacheKey = `${individual.id}-${timeSlot.id}`
                    availabilityCache.set(cacheKey, tier)


                }
            }

            // Trigger reactivity to update colors
            availabilityCache = availabilityCache
        } catch (error) {
            console.error('Error loading availability:', error)
            toast.error('Failed to load availability data', {
                description: 'Tier colors may not be accurate. Please try refreshing.'
            })
        } finally {
            loadingAvailability = false
        }
    }

    // Update issues when schedules change or availability cache updates
    $: {
        scheduleIssues = detectScheduleIssues()
    }

    // Reactive statement to reload availability when selectedDate changes
    $: if (selectedDate && timeSlots.length > 0 && individuals.length > 0) {
        loadAvailabilityForTimeSlots()
    }

    // Reactive statement to update issues when availability cache changes
    $: if (availabilityCache.size > 0 && schedules.length > 0) {
        scheduleIssues = detectScheduleIssues()
    }

    // Reactive statement to handle date changes
    let previousDate = selectedDate
    $: {
        if (selectedDate && selectedDate !== previousDate && !isUpdatingLocally) {
            previousDate = selectedDate
            // Load time slots first, then availability, then schedules
            loadTimeSlots().then(async () => {
                await loadAvailabilityForTimeSlots()
                await loadSchedules()
            })
        }
    }

    // Format time for display
    function formatTime(timeString) {
        return new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
    }
</script>

<div class="space-y-6">
    <div class="flex justify-between items-center">
        <div class="flex items-center gap-4">
            <h2 class="text-2xl font-bold">Schedule Grid</h2>
            {#if scheduleIssues.length > 0}
                {@const criticalIssues = scheduleIssues.filter(issue => issue.severity === 'critical')}
                {@const warnings = scheduleIssues.filter(issue => issue.severity === 'warning')}
                {@const conflicts = scheduleIssues.filter(issue => issue.type === 'conflict')}

                <!-- Critical Issues Button (Red) -->
                {#if criticalIssues.length > 0 || conflicts.length > 0}
                    <Button
                        variant="outline"
                        size="sm"
                        onclick={() => showIssuesDrawer = true}
                        class="text-red-600 border-red-300 hover:bg-red-50"
                    >
                        <AlertTriangle class="w-4 h-4 mr-1" />
                        {criticalIssues.length + conflicts.length} Critical Issue{(criticalIssues.length + conflicts.length) !== 1 ? 's' : ''}
                    </Button>
                {/if}

                <!-- Warnings Button (Orange) -->
                {#if warnings.length > 0}
                    <Button
                        variant="outline"
                        size="sm"
                        onclick={() => showIssuesDrawer = true}
                        class="text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                        <AlertTriangle class="w-4 h-4 mr-1" />
                        {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
                    </Button>
                {/if}
            {/if}
        </div>
        <div class="flex gap-4 items-center">
            <!-- Date Picker -->
            <div class="flex items-center gap-2">
                <Label for="date" class="text-sm font-medium">Date</Label>
                <Popover.Root bind:open={datePickerOpen}>
                    <Popover.Trigger>
                        <Button
                            variant="outline"
                            class="w-[240px] justify-start text-left font-normal"
                        >
                            <CalendarIcon class="mr-2 size-4" />
                            {dateValue ? df.format(dateValue.toDate(getLocalTimeZone())) : "Select a date"}
                        </Button>
                    </Popover.Trigger>
                    <Popover.Content class="w-auto p-0">
                        <Calendar
                            bind:value={dateValue}
                            type="single"
                            initialFocus
                            onValueChange={(value) => {
                                if (value) {
                                    selectedDate = value.toString()
                                    datePickerOpen = false
                                }
                            }}
                        />
                    </Popover.Content>
                </Popover.Root>

                <!-- Availability Loading Indicator -->
                {#if loadingAvailability}
                    <div class="flex items-center gap-1 text-sm text-gray-600">
                        <div class="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>
                        <span>Loading availability...</span>
                    </div>
                {/if}
            </div>

            {#if timeSlots.length === 0}
                <Button
                    onclick={handleGenerateTimeSlots}
                    disabled={generatingSlots}
                >
                    {generatingSlots ? 'Generating...' : 'Generate Time Slots'}
                </Button>
            {:else}
                <Button
                    onclick={handleAutoScheduleAll}
                    disabled={autoSchedulingAll}
                    variant="outline"
                    title={autoSchedulingAll ? 'Processing with rate limiting to prevent server overload' : 'Automatically fill all empty slots'}
                >
                    {autoSchedulingAll ? `🔄 Auto-scheduling... ${autoScheduleProgress}%` : '⚡ Auto Schedule All'}
                </Button>
                <Button
                    onclick={() => showUnscheduleDialog = true}
                    disabled={unschedulingAll || schedules.length === 0}
                    variant="outline"
                    class="text-red-600 border-red-300 hover:bg-red-50"
                    title="Remove all scheduled assignments for this date"
                >
                    {unschedulingAll ? '🔄 Clearing...' : '🗑️ Un-schedule All'}
                </Button>
                <Button
                    onclick={handleRefresh}
                    disabled={refreshing}
                    variant="ghost"
                    size="sm"
                    title="Refresh data"
                >
                    {refreshing ? '🔄' : '↻'}
                </Button>
            {/if}
        </div>
    </div>

    {#if loading}
        <div class="text-center py-8">Loading...</div>
    {:else if timeSlots.length === 0}
        <Card class="p-8 text-center">
            <p class="text-gray-600 mb-4">No time slots available for {selectedDate}.</p>
            <p class="text-sm text-gray-500 mb-4">Generate 30-minute time slots from 8 AM to 8 PM for this date.</p>
            <Button onclick={handleGenerateTimeSlots} disabled={generatingSlots}>
                {generatingSlots ? 'Generating...' : 'Generate Time Slots'}
            </Button>
        </Card>
    {:else}
        <!-- Excel-like Table Layout -->
        <div class="overflow-x-auto border border-gray-300 rounded-lg w-full">
            <table class="w-full border-collapse bg-white min-w-full">
                <!-- Table Header -->
                <thead>
                    <tr>
                        <th class="border border-gray-300 bg-gray-100 p-3 text-left font-semibold min-w-[150px] sticky left-0">
                            Time Range
                        </th>
                        {#each departments as department}
                            <th class="border border-gray-300 bg-gray-100 p-3 text-center font-semibold min-w-[200px]">
                                {department.name}
                            </th>
                        {/each}
                    </tr>
                </thead>

                <!-- Table Body -->
                <tbody>
                    {#each timeSlots as timeSlot}
                        <tr class="hover:bg-gray-50">
                            <!-- Time Range Column -->
                            <td class="border border-gray-300 p-3 bg-gray-50 font-medium sticky left-0">
                                <div class="text-sm">
                                    {formatTime(timeSlot.start_time)} - {formatTime(timeSlot.end_time)}
                                </div>
                                <div class="text-xs text-gray-500">
                                    30 min slot
                                </div>
                            </td>

                            <!-- Department Columns -->
                            {#each departments as department}
                                {@const schedule = getScheduleForSlot(department.id, timeSlot.id)}
                                <td
                                    class="border border-gray-300 p-2 min-h-[80px] relative"
                                    ondrop={(e) => handleDrop(e, department.id, timeSlot.id)}
                                    ondragover={handleDragOver}
                                >
                                    {#if schedule}
                                        <!-- Assigned Individual -->
                                        {@const scheduleColor = getScheduleColor(schedule)}
                                        <div
                                            class="{scheduleColor} rounded p-2 cursor-move h-full min-h-[60px] flex flex-col justify-between hover:opacity-90 transition-colors"
                                            draggable="true"
                                            ondragstart={() => handleDragStart(schedule)}
                                            role="button"
                                            tabindex="0"
                                        >
                                            <div>
                                                <div class="font-medium text-sm">
                                                    {schedule.individuals?.name}
                                                </div>
                                                {#if schedule.individuals?.email}
                                                    <div class="text-xs opacity-75 truncate">
                                                        {schedule.individuals.email}
                                                    </div>
                                                {/if}
                                            </div>
                                            <button
                                                class="text-red-600 hover:text-red-800 text-xs self-end bg-white rounded px-1 opacity-75 hover:opacity-100"
                                                onclick={() => handleDeleteSchedule(schedule.id)}
                                                title="Remove assignment"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    {:else}
                                        <!-- Empty Slot with Manual Selection -->
                                        {@const searchKey = getSearchKey(department.id, timeSlot.id)}
                                        {@const filteredIndividuals = getFilteredIndividuals(searchKey)}
                                        <div class="h-full min-h-[60px] flex flex-col gap-2">
                                            <!-- Manual Individual Selection -->
                                            <Select.Root
                                                type="single"
                                                value=""
                                                onValueChange={(value) => {
                                                    if (value) {
                                                        // Ensure we have a single string value, not an array
                                                        const individualId = Array.isArray(value) ? value[0] : value
                                                        handleManualSchedule(individualId, department.id, timeSlot.id)
                                                        // Clear search after selection
                                                        searchQueries[searchKey] = ''
                                                    }
                                                }}
                                                onOpenChange={(open) => {
                                                    if (open) {
                                                        // Focus the search input when dropdown opens
                                                        setTimeout(() => {
                                                            const searchInput = document.querySelector(`[data-search-key="${searchKey}"]`)
                                                            if (searchInput) {
                                                                searchInput.focus()
                                                            }
                                                        }, 100)
                                                    }
                                                }}
                                            >
                                                <Select.Trigger class="w-full h-8 text-xs">
                                                    <span class="text-gray-500">Select person...</span>
                                                </Select.Trigger>
                                                <Select.Content>
                                                    <!-- Search Input -->
                                                    <div class="p-2 border-b border-gray-200">
                                                        <Input
                                                            type="text"
                                                            placeholder="Search individuals..."
                                                            bind:value={searchQueries[searchKey]}
                                                            class="h-8 text-xs"
                                                            data-search-key={searchKey}
                                                            on:click={(e) => e.stopPropagation()}
                                                            on:keydown={(e) => {
                                                                e.stopPropagation()
                                                                // Handle keyboard navigation
                                                                if (e.key === 'Enter' && filteredIndividuals.length === 1) {
                                                                    // If only one result, select it on Enter
                                                                    const individualId = filteredIndividuals[0].id
                                                                    handleManualSchedule(individualId, department.id, timeSlot.id)
                                                                    searchQueries[searchKey] = ''
                                                                }
                                                            }}
                                                        />
                                                    </div>

                                                    <!-- Individual Options -->
                                                    {#if filteredIndividuals.length > 0}
                                                        {#each filteredIndividuals as individual}
                                                            <Select.Item value={individual.id} label={individual.name}>
                                                                <div class="flex flex-col">
                                                                    <span class="font-medium">{individual.name}</span>
                                                                    {#if individual.email}
                                                                        <span class="text-xs text-gray-500">{individual.email}</span>
                                                                    {/if}
                                                                </div>
                                                            </Select.Item>
                                                        {/each}
                                                    {:else}
                                                        <div class="p-2 text-xs text-gray-500 text-center">
                                                            {searchQueries[searchKey] ? 'No individuals found' : 'No individuals available'}
                                                        </div>
                                                    {/if}
                                                </Select.Content>
                                            </Select.Root>

                                            <!-- Auto Schedule Button -->
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onclick={() => handleAutoSchedule(department.id, timeSlot.id)}
                                                class="text-xs h-6"
                                            >
                                                Auto
                                            </Button>
                                        </div>
                                    {/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

<!-- Un-schedule All Confirmation Dialog -->
<AlertDialog.Root bind:open={showUnscheduleDialog}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Clear All Schedules</AlertDialog.Title>
            <AlertDialog.Description>
                Are you sure you want to remove all scheduled assignments for {selectedDate}?
                This action cannot be undone.
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
                onclick={handleUnscheduleAll}
                disabled={unschedulingAll}
                class="bg-red-600 hover:bg-red-700"
            >
                {unschedulingAll ? 'Clearing...' : 'Clear All Schedules'}
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>

<!-- Issues Drawer -->
<Sheet.Root bind:open={showIssuesDrawer}>
    <Sheet.Content side="right" class="w-[400px] sm:w-[540px]">
        <Sheet.Header>
            <Sheet.Title class="flex items-center gap-2">
                <AlertTriangle class="w-5 h-5 text-red-600" />
                Schedule Issues
            </Sheet.Title>
            <Sheet.Description>
                Issues detected in the current schedule that need attention.
            </Sheet.Description>
        </Sheet.Header>

        <div class="mt-6 space-y-4">
            {#if scheduleIssues.length === 0}
                <div class="text-center py-8 text-gray-500">
                    <AlertTriangle class="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No issues detected in the current schedule.</p>
                </div>
            {:else}
                {#each scheduleIssues as issue}
                    {@const isConflict = issue.type === 'conflict'}
                    {@const isUnavailable = issue.type === 'unavailable'}
                    {@const isSuboptimal = issue.type === 'suboptimal'}
                    {@const isCritical = issue.severity === 'critical'}
                    {@const isWarning = issue.severity === 'warning'}

                    <!-- Different styling based on severity -->
                    {@const cardClass = isCritical ? 'border-red-300 bg-red-100' : isWarning ? 'border-orange-300 bg-orange-50' : 'border-red-200 bg-red-50'}
                    {@const iconClass = isCritical ? 'text-red-600' : isWarning ? 'text-orange-600' : 'text-red-600'}
                    {@const textClass = isCritical ? 'text-red-900' : isWarning ? 'text-orange-900' : 'text-red-900'}
                    {@const subtextClass = isCritical ? 'text-red-800' : isWarning ? 'text-orange-800' : 'text-red-800'}
                    {@const detailClass = isCritical ? 'text-red-600' : isWarning ? 'text-orange-600' : 'text-red-600'}

                    <div class="border rounded-lg p-4 {cardClass}">
                        <div class="flex items-start gap-3">
                            <AlertTriangle class="w-5 h-5 {iconClass} mt-0.5 flex-shrink-0" />
                            <div class="flex-1">
                                <div class="font-medium {textClass} mb-1 flex items-center gap-2">
                                    {#if isConflict}
                                        Scheduling Conflict
                                        <span class="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">CRITICAL</span>
                                    {:else if isUnavailable}
                                        Physically Unavailable
                                        <span class="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">CRITICAL</span>
                                    {:else if isSuboptimal}
                                        Suboptimal Assignment
                                        <span class="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full">WARNING</span>
                                    {:else}
                                        Schedule Issue
                                    {/if}
                                </div>
                                <div class="text-sm {subtextClass} mb-2">
                                    {issue.message}
                                </div>
                                <div class="text-xs {detailClass}">
                                    Time: {issue.timeSlot}
                                </div>
                                {#if isConflict && issue.departmentCount}
                                    <div class="text-xs {detailClass} mt-1">
                                        Person is scheduled in {issue.departmentCount} departments simultaneously.
                                    </div>
                                {/if}
                                {#if isUnavailable}
                                    <div class="text-xs {detailClass} mt-1">
                                        This person is marked as "Not Available" (Tier 4) and physically cannot be there.
                                    </div>
                                {/if}
                                {#if isSuboptimal}
                                    <div class="text-xs {detailClass} mt-1">
                                        This person is "Only If Exhausted" (Tier 3). Consider changing their availability or finding alternatives.
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>

        <Sheet.Footer class="mt-6">
            <Button variant="outline" onclick={() => showIssuesDrawer = false}>
                Close
            </Button>
        </Sheet.Footer>
    </Sheet.Content>
</Sheet.Root>

<style>
    /* Excel-like table styling */
    table {
        font-size: 14px;
        position: relative;
    }

    th, td {
        vertical-align: top;
    }

    /* Sticky column styling with higher z-index */
    .sticky {
        position: sticky;
        background-color: inherit;
        box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1);
    }

    /* Ensure sticky header has highest z-index */
    thead th.sticky {
        z-index: 30 !important;
        background-color: #f3f4f6;
        border-right: 2px solid #d1d5db;
    }

    /* Ensure sticky body cells have high z-index */
    tbody td.sticky {
        z-index: 20 !important;
        background-color: #f9fafb;
        border-right: 2px solid #d1d5db;
    }

    /* Improve select dropdown in table cells */
    :global(.select-trigger) {
        border: 1px solid #d1d5db;
        background: white;
    }

    :global(.select-trigger:hover) {
        border-color: #9ca3af;
    }

    /* Ensure table scrolls horizontally */
    .overflow-x-auto {
        position: relative;
    }
</style>
