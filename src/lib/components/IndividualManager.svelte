<script>
    import { onMount } from 'svelte'
    import { getIndividuals, createIndividual, deleteIndividual } from '$lib/database.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import * as Dialog from '$lib/components/ui/dialog'
    import { toast } from 'svelte-sonner'

    let individuals = []
    let loading = false
    let showAddDialog = false
    let newIndividual = { name: '', email: '', phone: '' }

    onMount(async () => {
        await loadIndividuals()
    })

    async function loadIndividuals() {
        loading = true
        try {
            individuals = await getIndividuals()
        } catch (error) {
            console.error('Error loading individuals:', error)
            toast.error('Failed to load individuals', {
                description: 'Please try again.'
            })
        } finally {
            loading = false
        }
    }

    async function handleAddIndividual() {
        if (!newIndividual.name.trim()) return

        try {
            await createIndividual(newIndividual)
            const individualName = newIndividual.name
            newIndividual = { name: '', email: '', phone: '' }
            showAddDialog = false
            toast.success('Individual added successfully!', {
                description: `"${individualName}" has been created.`
            })
            await loadIndividuals()
        } catch (error) {
            console.error('Error adding individual:', error)
            toast.error('Failed to add individual', {
                description: 'Please try again.'
            })
        }
    }

    async function handleDeleteIndividual(id) {
        const individual = individuals.find(i => i.id === id)
        const individualName = individual?.name || 'Unknown'

        if (!confirm(`Are you sure you want to delete "${individualName}"?`)) return

        try {
            await deleteIndividual(id)
            toast.success('Individual deleted successfully!', {
                description: `"${individualName}" has been removed.`
            })
            await loadIndividuals()
        } catch (error) {
            console.error('Error deleting individual:', error)
            toast.error('Failed to delete individual', {
                description: 'Please try again.'
            })
        }
    }
</script>

<div class="space-y-4">
    <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold">Individuals</h2>
        <Button onclick={() => showAddDialog = true}>Add Individual</Button>
    </div>

    {#if loading}
        <div class="text-center py-8">Loading...</div>
    {:else}
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each individuals as individual (individual.id)}
                <Card class="p-4">
                    <div class="space-y-2">
                        <h3 class="font-semibold">{individual.name}</h3>
                        {#if individual.email}
                            <p class="text-sm text-gray-600">{individual.email}</p>
                        {/if}
                        {#if individual.phone}
                            <p class="text-sm text-gray-600">{individual.phone}</p>
                        {/if}
                        <div class="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() => handleDeleteIndividual(individual.id)}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </Card>
            {/each}
        </div>
    {/if}
</div>

<Dialog.Root bind:open={showAddDialog}>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content class="sm:max-w-md">
            <Dialog.Header>
                <Dialog.Title>Add New Individual</Dialog.Title>
            </Dialog.Header>

            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label for="name">Name *</Label>
                    <Input
                        id="name"
                        bind:value={newIndividual.name}
                        placeholder="Enter name"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        bind:value={newIndividual.email}
                        placeholder="Enter email"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="phone">Phone</Label>
                    <Input
                        id="phone"
                        bind:value={newIndividual.phone}
                        placeholder="Enter phone number"
                    />
                </div>
            </div>

            <Dialog.Footer>
                <Button variant="outline" onclick={() => showAddDialog = false}>
                    Cancel
                </Button>
                <Button onclick={handleAddIndividual} disabled={!newIndividual.name.trim()}>
                    Add Individual
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
