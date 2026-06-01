<script>
    import { onMount } from 'svelte'
    import { getIndividuals, getAvailability, setAvailability, deleteAvailability } from '$lib/database.js'
    import Card from '$lib/components/ui/card/card.svelte'
    import * as Select from '$lib/components/ui/select/index.js'
    import Label from '$lib/components/ui/label/label.svelte'
    import Button from '$lib/components/ui/button/button.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import * as Dialog from '$lib/components/ui/dialog'
    import { toast } from 'svelte-sonner'

    let individuals = []
    let availability = []
    let selectedIndividual = undefined

    let loading = false
    let showAddDialog = false
    let searchQuery = ''
    let filteredIndividuals = []
    let selectedDateRange = {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 14 days from now
    }
    let newAvailability = {
        date: new Date().toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '17:00',
        tier: 1
    }

    const tierOptions = [
        { value: 1, label: 'Tier 1 - Highly Available', color: 'bg-green-100 text-green-800' },
        { value: 2, label: 'Tier 2 - Available When Needed', color: 'bg-yellow-100 text-yellow-800' },
        { value: 3, label: 'Tier 3 - Only If Exhausted', color: 'bg-orange-100 text-orange-800' },
        { value: 4, label: 'Tier 4 - Not Available', color: 'bg-red-100 text-red-800' }
    ]

    // Helper functions for date formatting
    function formatDate(dateStr) {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
    }

    function formatTime(timeStr) {
        return new Date(`2000-01-01T${timeStr}`).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
    }

    onMount(async () => {
        await loadData()
    })

    async function loadData() {
        loading = true
        try {
            individuals = await getIndividuals()
            console.log('Loaded individuals:', individuals)
        } catch (error) {
            console.error('Error loading data:', error)
            toast.error('Failed to load individuals', {
                description: 'Please try again.'
            })
        } finally {
            loading = false
        }
    }

    async function loadAvailability() {
        if (!selectedIndividual) {
            console.log('No selected individual, skipping availability load')
            return
        }

        console.log('Loading availability for:', selectedIndividual)
        try {
            availability = await getAvailability(
                selectedIndividual,
                selectedDateRange.startDate,
                selectedDateRange.endDate
            )
            console.log('Loaded availability:', availability)
        } catch (error) {
            console.error('Error loading availability:', error)
            toast.error('Failed to load availability', {
                description: 'Please try again.'
            })
        }
    }

    function getTierInfo(tier) {
        return tierOptions.find(t => t.value === tier) || tierOptions[3]
    }

    async function handleAddAvailability() {
        if (!selectedIndividual) return

        const individualName = individuals.find(i => i.id === selectedIndividual)?.name || 'Unknown'
        const tierInfo = getTierInfo(newAvailability.tier)

        try {
            await setAvailability(
                selectedIndividual,
                newAvailability.date,
                newAvailability.start_time,
                newAvailability.end_time,
                newAvailability.tier
            )
            newAvailability = {
                date: new Date().toISOString().split('T')[0],
                start_time: '09:00',
                end_time: '17:00',
                tier: 1
            }

            showAddDialog = false
            toast.success('Availability added!', {
                description: `${individualName} - ${formatDate(newAvailability.date)} ${formatTime(newAvailability.start_time)}-${formatTime(newAvailability.end_time)} (${tierInfo.label})`
            })
            await loadAvailability()
        } catch (error) {
            console.error('Error adding availability:', error)
            toast.error('Failed to add availability', {
                description: 'Please try again.'
            })
        }
    }

    async function handleDeleteAvailability(availabilityId) {
        const availabilityItem = availability.find(a => a.id === availabilityId)
        const individualName = individuals.find(i => i.id === selectedIndividual)?.name || 'Unknown'
        const dateStr = availabilityItem ? formatDate(availabilityItem.date) : 'Unknown'

        if (!confirm(`Are you sure you want to delete the availability for ${individualName} on ${dateStr}?`)) return

        try {
            await deleteAvailability(availabilityId)
            toast.success('Availability deleted!', {
                description: `Removed availability for ${individualName} on ${dateStr}.`
            })
            await loadAvailability()
        } catch (error) {
            console.error('Error deleting availability:', error)
            toast.error('Failed to delete availability', {
                description: 'Please try again.'
            })
        }
    }

    $: if (selectedIndividual) {
        console.log('Loading availability for individual:', selectedIndividual)
        loadAvailability()
    }

    // Filter individuals based on search query
    $: filteredIndividuals = individuals.filter(individual =>
        individual.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // Group availability by date
    $: availabilityByDate = availability.reduce((acc, item) => {
        const date = item.date
        if (!acc[date]) acc[date] = []
        acc[date].push(item)
        return acc
    }, {})
</script>

<div class="space-y-6">
    <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold">Availability Management</h2>
    </div>

    {#if loading}
        <div class="text-center py-8">Loading...</div>
    {:else}
        <div class="space-y-4">
            <div class="space-y-2">
                <Label>Select Individual</Label>
                <Select.Root
                    type="single"
                    bind:value={selectedIndividual}
                    onValueChange={(value) => {
                        console.log('Value changed to:', value)
                        selectedIndividual = value
                        searchQuery = '' // Clear search when selection is made
                    }}
                >
                    <Select.Trigger class="w-full">
                        {individuals.find(i => i.id === selectedIndividual)?.name || "Choose an individual..."}
                    </Select.Trigger>
                    <Select.Content>
                        <div class="p-2 border-b">
                            <Input
                                type="text"
                                placeholder="Search individuals..."
                                bind:value={searchQuery}
                                class="w-full"
                            />
                        </div>
                        <div class="max-h-48 overflow-y-auto">
                            {#each filteredIndividuals as individual}
                                <Select.Item value={individual.id}>
                                    {individual.name}
                                </Select.Item>
                            {:else}
                                <div class="p-2 text-sm text-gray-500 text-center">
                                    No individuals found matching "{searchQuery}"
                                </div>
                            {/each}
                        </div>
                    </Select.Content>
                </Select.Root>
            </div>

            <!-- Date Range Selection -->
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                        type="date"
                        bind:value={selectedDateRange.startDate}
                        onchange={() => {
                            if (selectedIndividual) loadAvailability()
                        }}
                    />
                </div>
                <div class="space-y-2">
                    <Label>End Date</Label>
                    <Input
                        type="date"
                        bind:value={selectedDateRange.endDate}
                        onchange={() => {
                            if (selectedIndividual) loadAvailability()
                        }}
                    />
                </div>
            </div>

            {#if selectedIndividual}
                <Card class="p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold">
                            Availability for {individuals.find(i => i.id === selectedIndividual)?.name}
                        </h3>
                        <Button onclick={() => showAddDialog = true}>Add Availability</Button>
                    </div>

                    <div class="space-y-4">
                        {#if Object.keys(availabilityByDate).length === 0}
                            <div class="text-gray-500 text-center py-8">
                                No availability set for the selected date range.
                                <br>
                                Click "Add Availability" to get started.
                            </div>
                        {:else}
                            {#each Object.entries(availabilityByDate).sort() as [date, items]}
                                <div>
                                    <h4 class="font-medium text-lg mb-3">{formatDate(date)}</h4>
                                    <div class="space-y-2">
                                        {#each items.sort((a, b) => a.start_time.localeCompare(b.start_time)) as item}
                                            {@const tierInfo = getTierInfo(item.tier)}
                                            <div class="border rounded-lg p-3 flex justify-between items-center">
                                                <div class="flex items-center gap-4">
                                                    <div class="font-medium">
                                                        {formatTime(item.start_time)} - {formatTime(item.end_time)}
                                                    </div>
                                                    <span class="px-2 py-1 rounded text-xs {tierInfo.color}">
                                                        {tierInfo.label}
                                                    </span>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onclick={() => handleDeleteAvailability(item.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/each}
                        {/if}
                    </div>
                </Card>
            {/if}
        </div>
    {/if}
</div>

<Dialog.Root bind:open={showAddDialog}>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content class="sm:max-w-md">
            <Dialog.Header>
                <Dialog.Title>Add Availability</Dialog.Title>
                <Dialog.Description>
                    Set availability for {individuals.find(i => i.id === selectedIndividual)?.name}
                </Dialog.Description>
            </Dialog.Header>

            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label>Date</Label>
                    <Input
                        type="date"
                        bind:value={newAvailability.date}
                        min={selectedDateRange.startDate}
                        max={selectedDateRange.endDate}
                    />
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <Label>Start Time</Label>
                        <Input
                            type="time"
                            bind:value={newAvailability.start_time}
                        />
                    </div>

                    <div class="space-y-2">
                        <Label>End Time</Label>
                        <Input
                            type="time"
                            bind:value={newAvailability.end_time}
                        />
                    </div>
                </div>

                <div class="space-y-2">
                    <Label>Availability Tier</Label>
                    <Select.Root
                        type="single"
                        bind:value={newAvailability.tier}
                        onValueChange={(value) => {
                            console.log('Tier changed to:', value)
                            newAvailability.tier = value
                        }}
                    >
                        <Select.Trigger class="w-full">
                            {tierOptions.find(t => t.value === newAvailability.tier)?.label || "Choose tier..."}
                        </Select.Trigger>
                        <Select.Content>
                            {#each tierOptions as option}
                                <Select.Item value={option.value}>
                                    <span class="px-2 py-1 rounded text-xs {option.color}">
                                        {option.label}
                                    </span>
                                </Select.Item>
                            {/each}
                        </Select.Content>
                    </Select.Root>
                </div>
            </div>

            <Dialog.Footer>
                <Button variant="outline" onclick={() => {
                    newAvailability = {
                        date: new Date().toISOString().split('T')[0],
                        start_time: '09:00',
                        end_time: '17:00',
                        tier: 1
                    }
                    showAddDialog = false
                }}>
                    Cancel
                </Button>
                <Button onclick={handleAddAvailability}>
                    Add Availability
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
