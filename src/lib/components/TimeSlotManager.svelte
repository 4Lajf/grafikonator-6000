<script>
    import { onMount } from 'svelte'
    import { getTimeSlots, generateTimeSlotsForDate, generateTimeSlotsForRange, deleteTimeSlot, deleteTimeSlotsForDate } from '$lib/database.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import * as Dialog from '$lib/components/ui/dialog'
    import * as AlertDialog from '$lib/components/ui/alert-dialog'
    import { Trash2, Calendar } from 'lucide-svelte'
    import { toast } from 'svelte-sonner'

    let timeSlots = []
    let loading = false
    let showGenerateDialog = false
    let showDeleteDialog = false
    let showDeleteDateDialog = false
    let timeSlotToDelete = null
    let dateToDelete = null
    let generateOptions = {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
        startHour: 8,
        endHour: 20
    }
    let generating = false

    onMount(async () => {
        await loadTimeSlots()
    })

    async function loadTimeSlots() {
        loading = true
        try {
            timeSlots = await getTimeSlots()
        } catch (err) {
            console.error('Error loading time slots:', err)
            toast.error('Failed to load time slots', {
                description: 'Please try again.'
            })
        } finally {
            loading = false
        }
    }

    async function handleGenerateRange() {
        generating = true
        try {
            const count = await generateTimeSlotsForRange(
                generateOptions.startDate,
                generateOptions.endDate,
                generateOptions.startHour,
                generateOptions.endHour
            )
            showGenerateDialog = false
            toast.success('Time slots generated successfully!', {
                description: `Generated ${count} time slots from ${generateOptions.startDate} to ${generateOptions.endDate}.`
            })
            await loadTimeSlots()
        } catch (err) {
            console.error('Error generating time slots:', err)
            toast.error('Error generating time slots', {
                description: err.message
            })
        } finally {
            generating = false
        }
    }

    function confirmDeleteTimeSlot(timeSlot) {
        timeSlotToDelete = timeSlot
        showDeleteDialog = true
    }

    function confirmDeleteDate(date) {
        dateToDelete = date
        showDeleteDateDialog = true
    }

    async function handleDeleteTimeSlot() {
        if (!timeSlotToDelete) return

        const timeSlotInfo = `${formatTime(timeSlotToDelete.start_time)} - ${formatTime(timeSlotToDelete.end_time)}`

        try {
            await deleteTimeSlot(timeSlotToDelete.id)
            showDeleteDialog = false
            timeSlotToDelete = null
            toast.success('Time slot deleted successfully!', {
                description: `Removed ${timeSlotInfo}.`
            })
            await loadTimeSlots()
        } catch (err) {
            console.error('Error deleting time slot:', err)
            showDeleteDialog = false
            timeSlotToDelete = null
            if (err.message.includes('existing schedules')) {
                toast.error('Cannot delete time slot', {
                    description: 'This time slot has existing schedules. Please remove all schedules first.'
                })
            } else {
                toast.error('Failed to delete time slot', {
                    description: 'Please try again.'
                })
            }
        }
    }

    async function handleDeleteDate() {
        if (!dateToDelete) return

        const dateInfo = formatDate(dateToDelete)

        try {
            const count = await deleteTimeSlotsForDate(dateToDelete)
            showDeleteDateDialog = false
            dateToDelete = null
            toast.success('Time slots deleted successfully!', {
                description: `Deleted ${count} time slots for ${dateInfo}.`
            })
            await loadTimeSlots()
        } catch (err) {
            console.error('Error deleting time slots for date:', err)
            showDeleteDateDialog = false
            dateToDelete = null
            if (err.message.includes('existing schedules')) {
                toast.error('Cannot delete time slots', {
                    description: 'Some time slots have existing schedules. Please remove all schedules first.'
                })
            } else {
                toast.error('Failed to delete time slots', {
                    description: 'Please try again.'
                })
            }
        }
    }

    // Group time slots by date
    $: timeSlotsByDate = timeSlots.reduce((acc, slot) => {
        const date = slot.date
        if (!acc[date]) acc[date] = []
        acc[date].push(slot)
        return acc
    }, {})

    // Format time for display
    function formatTime(timeString) {
        return new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
    }

    // Format date for display
    function formatDate(dateString) {
        return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
    }
</script>

<div class="space-y-6">
    <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold">Time Slot Management</h2>
        <Button onclick={() => showGenerateDialog = true}>Generate Time Slots</Button>
    </div>

    {#if loading}
        <div class="text-center py-8">Loading...</div>
    {:else if Object.keys(timeSlotsByDate).length === 0}
        <Card class="p-8 text-center">
            <h3 class="text-lg font-semibold mb-2">No Time Slots Found</h3>
            <p class="text-gray-600 mb-4">Generate 30-minute time slots for specific dates to start scheduling.</p>
            <Button onclick={() => showGenerateDialog = true}>Generate Time Slots</Button>
        </Card>
    {:else}
        <div class="space-y-6">
            <div class="text-sm text-gray-600">
                Total time slots: {timeSlots.length} across {Object.keys(timeSlotsByDate).length} dates
            </div>

            <div class="space-y-4">
                {#each Object.entries(timeSlotsByDate).sort() as [date, slots]}
                    <Card class="p-4">
                        <div class="flex justify-between items-center mb-3">
                            <h3 class="font-semibold">{formatDate(date)}</h3>
                            <div class="flex gap-2">
                                <span class="text-sm text-gray-500">{slots.length} slots</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onclick={() => confirmDeleteDate(date)}
                                    class="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
                                    title="Delete all time slots for this date"
                                >
                                    <Calendar size="16" />
                                    <Trash2 size="14" />
                                </Button>
                            </div>
                        </div>
                        <div class="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
                            {#each slots.sort((a, b) => a.start_time.localeCompare(b.start_time)) as slot}
                                <div class="border rounded p-2 text-sm relative group">
                                    <div class="font-medium">
                                        {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                                    </div>
                                    <div class="text-xs text-gray-500">
                                        {slot.is_active ? 'Active' : 'Inactive'}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onclick={() => confirmDeleteTimeSlot(slot)}
                                        class="absolute top-1 right-1 text-red-600 hover:text-red-700 hover:bg-red-50 p-1 h-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Delete this time slot"
                                    >
                                        <Trash2 size="12" />
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    </Card>
                {/each}
            </div>
        </div>
    {/if}
</div>

<Dialog.Root bind:open={showGenerateDialog}>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content class="sm:max-w-md">
            <Dialog.Header>
                <Dialog.Title>Generate Time Slots</Dialog.Title>
                <Dialog.Description>
                    Create 30-minute time slots for a date range. This will generate slots from start hour to end hour for each day.
                </Dialog.Description>
            </Dialog.Header>

            <div class="space-y-4 py-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label for="startDate">Start Date</Label>
                        <Input
                            id="startDate"
                            type="date"
                            bind:value={generateOptions.startDate}
                        />
                    </div>

                    <div class="space-y-2">
                        <Label for="endDate">End Date</Label>
                        <Input
                            id="endDate"
                            type="date"
                            bind:value={generateOptions.endDate}
                        />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label for="startHour">Start Hour (24h)</Label>
                        <Input
                            id="startHour"
                            type="number"
                            min="0"
                            max="23"
                            bind:value={generateOptions.startHour}
                        />
                    </div>

                    <div class="space-y-2">
                        <Label for="endHour">End Hour (24h)</Label>
                        <Input
                            id="endHour"
                            type="number"
                            min="1"
                            max="24"
                            bind:value={generateOptions.endHour}
                        />
                    </div>
                </div>

                <div class="text-sm text-gray-600">
                    This will generate {(generateOptions.endHour - generateOptions.startHour) * 2} time slots per day
                    (30-minute intervals from {generateOptions.startHour}:00 to {generateOptions.endHour}:00).
                </div>
            </div>

            <Dialog.Footer>
                <Button variant="outline" onclick={() => showGenerateDialog = false}>
                    Cancel
                </Button>
                <Button onclick={handleGenerateRange} disabled={generating}>
                    {generating ? 'Generating...' : 'Generate Time Slots'}
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>

<!-- Delete Time Slot Confirmation Dialog -->
<AlertDialog.Root bind:open={showDeleteDialog}>
    <AlertDialog.Portal>
        <AlertDialog.Overlay />
        <AlertDialog.Content>
            <AlertDialog.Header>
                <AlertDialog.Title>Delete Time Slot</AlertDialog.Title>
                <AlertDialog.Description>
                    Are you sure you want to delete the time slot from {timeSlotToDelete ? formatTime(timeSlotToDelete.start_time) : ''} to {timeSlotToDelete ? formatTime(timeSlotToDelete.end_time) : ''}?
                    <br><br>
                    <strong>Note:</strong> You cannot delete a time slot that has existing schedules.
                </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
                <AlertDialog.Cancel onclick={() => {
                    showDeleteDialog = false
                    timeSlotToDelete = null
                }}>
                    Cancel
                </AlertDialog.Cancel>
                <AlertDialog.Action onclick={handleDeleteTimeSlot} class="bg-red-600 hover:bg-red-700">
                    Delete
                </AlertDialog.Action>
            </AlertDialog.Footer>
        </AlertDialog.Content>
    </AlertDialog.Portal>
</AlertDialog.Root>

<!-- Delete Date Confirmation Dialog -->
<AlertDialog.Root bind:open={showDeleteDateDialog}>
    <AlertDialog.Portal>
        <AlertDialog.Overlay />
        <AlertDialog.Content>
            <AlertDialog.Header>
                <AlertDialog.Title>Delete All Time Slots for Date</AlertDialog.Title>
                <AlertDialog.Description>
                    Are you sure you want to delete ALL time slots for {dateToDelete ? formatDate(dateToDelete) : ''}?
                    <br><br>
                    This will delete {dateToDelete ? timeSlotsByDate[dateToDelete]?.length || 0 : 0} time slots and cannot be undone.
                    <br><br>
                    <strong>Note:</strong> You cannot delete time slots that have existing schedules.
                </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
                <AlertDialog.Cancel onclick={() => {
                    showDeleteDateDialog = false
                    dateToDelete = null
                }}>
                    Cancel
                </AlertDialog.Cancel>
                <AlertDialog.Action onclick={handleDeleteDate} class="bg-red-600 hover:bg-red-700">
                    Delete All
                </AlertDialog.Action>
            </AlertDialog.Footer>
        </AlertDialog.Content>
    </AlertDialog.Portal>
</AlertDialog.Root>
