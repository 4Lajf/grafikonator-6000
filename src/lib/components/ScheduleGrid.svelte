<script>
    import { onMount } from 'svelte'
    import { draggable } from '@neodrag/svelte'
    import { getDepartments, getTimeSlots, getSchedules, createSchedule, updateSchedule, deleteSchedule, autoSchedule, generateTimeSlotsForDate } from '$lib/database.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import { toast } from 'svelte-sonner'

    let departments = []
    let timeSlots = []
    let schedules = []
    let selectedDate = new Date().toISOString().split('T')[0]
    let loading = false
    let draggedSchedule = null
    let generatingSlots = false

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    onMount(async () => {
        await loadData()
        await loadSchedules()
    })

    async function loadData() {
        loading = true
        try {
            departments = await getDepartments()
            await loadTimeSlots()
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
            await loadTimeSlots()
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

    async function handleAutoSchedule(departmentId, timeSlotId) {
        try {
            const schedule = await autoSchedule(departmentId, timeSlotId)
            toast.success('Auto-scheduled successfully!', {
                description: `Assigned ${schedule.individuals?.name} to ${schedule.departments?.name}.`
            })
            await loadSchedules()
        } catch (error) {
            toast.error('Auto-scheduling failed', {
                description: error.message
            })
        }
    }

    async function handleDeleteSchedule(scheduleId) {
        const schedule = schedules.find(s => s.id === scheduleId)
        const individualName = schedule?.individuals?.name || 'Unknown'
        const departmentName = schedule?.departments?.name || 'Unknown'

        if (!confirm(`Are you sure you want to remove ${individualName} from ${departmentName}?`)) return

        try {
            await deleteSchedule(scheduleId)
            toast.success('Schedule deleted!', {
                description: `Removed ${individualName} from ${departmentName}.`
            })
            await loadSchedules()
        } catch (error) {
            console.error('Error deleting schedule:', error)
            toast.error('Failed to delete schedule', {
                description: 'Please try again.'
            })
        }
    }

    function handleDragStart(schedule) {
        draggedSchedule = schedule
    }

    async function handleDrop(event, departmentId, timeSlotId) {
        event.preventDefault()
        
        if (!draggedSchedule) return
        
        // Check if there's already a schedule in this slot
        const existingSchedule = getScheduleForSlot(departmentId, timeSlotId)
        if (existingSchedule && existingSchedule.id !== draggedSchedule.id) {
            toast.error('Slot already occupied', {
                description: 'This time slot is already assigned to someone else.'
            })
            return
        }

        // Check if the person is already scheduled at this time in another department
        const conflictingSchedule = schedules.find(s =>
            s.individual_id === draggedSchedule.individual_id &&
            s.time_slot_id === timeSlotId &&
            s.id !== draggedSchedule.id
        )

        if (conflictingSchedule) {
            toast.error('Scheduling conflict', {
                description: 'This person is already scheduled at this time in another department.'
            })
            return
        }

        try {
            await updateSchedule(draggedSchedule.id, {
                department_id: departmentId,
                time_slot_id: timeSlotId
            })
            const departmentName = departments.find(d => d.id === departmentId)?.name || 'Unknown'
            toast.success('Schedule moved!', {
                description: `Moved ${draggedSchedule.individuals?.name} to ${departmentName}.`
            })
            await loadSchedules()
        } catch (error) {
            console.error('Error updating schedule:', error)
            toast.error('Failed to move schedule', {
                description: error.message
            })
        }
        
        draggedSchedule = null
    }

    function handleDragOver(event) {
        event.preventDefault()
    }

    $: {
        if (selectedDate) {
            loadTimeSlots()
            loadSchedules()
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
        <h2 class="text-2xl font-bold">Schedule Grid</h2>
        <div class="flex gap-4 items-center">
            <div class="space-y-1">
                <Label for="date">Date</Label>
                <Input
                    id="date"
                    type="date"
                    bind:value={selectedDate}
                    class="w-auto"
                />
            </div>
            {#if timeSlots.length === 0}
                <Button
                    onclick={handleGenerateTimeSlots}
                    disabled={generatingSlots}
                >
                    {generatingSlots ? 'Generating...' : 'Generate Time Slots'}
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
        <div class="overflow-x-auto">
            <div class="min-w-full">
                <!-- Header -->
                <div class="grid grid-cols-[200px_repeat({departments.length},1fr)] gap-2 mb-4">
                    <div class="font-semibold p-3 bg-gray-100 rounded">Time Slot</div>
                    {#each departments as department}
                        <div class="font-semibold p-3 bg-gray-100 rounded text-center">
                            {department.name}
                        </div>
                    {/each}
                </div>

                <!-- Schedule Grid -->
                <div class="space-y-2">
                    {#each timeSlots as timeSlot}
                        <div class="grid grid-cols-[200px_repeat({departments.length},1fr)] gap-2">
                            <!-- Time slot info -->
                            <div class="p-3 bg-gray-50 rounded flex flex-col justify-center">
                                <div class="font-medium text-sm">
                                    {formatTime(timeSlot.start_time)} - {formatTime(timeSlot.end_time)}
                                </div>
                                <div class="text-xs text-gray-500">
                                    30 min slot
                                </div>
                            </div>

                            <!-- Department slots -->
                            {#each departments as department}
                                {@const schedule = getScheduleForSlot(department.id, timeSlot.id)}
                                <div
                                    class="min-h-[80px] border-2 border-dashed border-gray-300 rounded p-2 relative"
                                    ondrop={(e) => handleDrop(e, department.id, timeSlot.id)}
                                    ondragover={handleDragOver}
                                    role="button"
                                    tabindex="0"
                                >
                                    {#if schedule}
                                        <div
                                            class="bg-blue-100 border border-blue-300 rounded p-2 cursor-move h-full flex flex-col justify-between"
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
                                                    <div class="text-xs text-gray-600">
                                                        {schedule.individuals.email}
                                                    </div>
                                                {/if}
                                            </div>
                                            <button
                                                class="text-red-600 hover:text-red-800 text-xs self-end"
                                                onclick={() => handleDeleteSchedule(schedule.id)}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    {:else}
                                        <div class="h-full flex items-center justify-center">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onclick={() => handleAutoSchedule(department.id, timeSlot.id)}
                                            >
                                                Auto Schedule
                                            </Button>
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .grid {
        display: grid;
    }
</style>
