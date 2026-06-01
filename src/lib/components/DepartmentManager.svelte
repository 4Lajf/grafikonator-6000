<script>
    import { onMount } from 'svelte'
    import { getDepartments, createDepartment, deleteDepartment } from '$lib/database.js'
    import Button from '$lib/components/ui/button/button.svelte'
    import Card from '$lib/components/ui/card/card.svelte'
    import Input from '$lib/components/ui/input/input.svelte'
    import Label from '$lib/components/ui/label/label.svelte'
    import * as Dialog from '$lib/components/ui/dialog'
    import * as AlertDialog from '$lib/components/ui/alert-dialog'
    import { Trash2 } from 'lucide-svelte'
    import { toast } from 'svelte-sonner'

    let departments = []
    let loading = false
    let showAddDialog = false
    let showDeleteDialog = false
    let departmentToDelete = null
    let newDepartment = { name: '', description: '' }

    onMount(async () => {
        await loadDepartments()
    })

    async function loadDepartments() {
        loading = true
        try {
            departments = await getDepartments()
        } catch (err) {
            console.error('Error loading departments:', err)
            toast.error('Failed to load departments', {
                description: 'Please try again.'
            })
        } finally {
            loading = false
        }
    }

    async function handleAddDepartment() {
        if (!newDepartment.name.trim()) return

        try {
            await createDepartment(newDepartment)
            newDepartment = { name: '', description: '' }
            showAddDialog = false
            toast.success('Department added successfully!', {
                description: `"${newDepartment.name}" has been created.`
            })
            await loadDepartments()
        } catch (err) {
            console.error('Error adding department:', err)
            toast.error('Failed to add department', {
                description: 'Please try again.'
            })
        }
    }

    function confirmDelete(department) {
        departmentToDelete = department
        showDeleteDialog = true
    }

    async function handleDeleteDepartment() {
        if (!departmentToDelete) return

        const departmentName = departmentToDelete.name

        try {
            await deleteDepartment(departmentToDelete.id)
            showDeleteDialog = false
            departmentToDelete = null
            toast.success('Department deleted successfully!', {
                description: `"${departmentName}" has been removed.`
            })
            await loadDepartments()
        } catch (err) {
            console.error('Error deleting department:', err)
            showDeleteDialog = false
            departmentToDelete = null
            if (err.message.includes('existing schedules')) {
                toast.error('Cannot delete department', {
                    description: 'This department has existing schedules. Please remove all schedules first.'
                })
            } else {
                toast.error('Failed to delete department', {
                    description: 'Please try again.'
                })
            }
        }
    }
</script>

<div class="space-y-4">
    <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold">Departments</h2>
        <Button onclick={() => showAddDialog = true}>Add Department</Button>
    </div>

    {#if loading}
        <div class="text-center py-8">Loading...</div>
    {:else if departments.length === 0}
        <div class="text-center py-8 text-gray-500">
            No departments found. Add your first department to get started.
        </div>
    {:else}
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each departments as department (department.id)}
                <Card class="p-4">
                    <div class="space-y-2">
                        <div class="flex justify-between items-start">
                            <h3 class="font-semibold">{department.name}</h3>
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={() => confirmDelete(department)}
                                class="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
                            >
                                <Trash2 size="16" />
                            </Button>
                        </div>
                        {#if department.description}
                            <p class="text-sm text-gray-600">{department.description}</p>
                        {/if}
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
                <Dialog.Title>Add New Department</Dialog.Title>
            </Dialog.Header>

            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label for="name">Name *</Label>
                    <Input
                        id="name"
                        bind:value={newDepartment.name}
                        placeholder="Enter department name"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="description">Description</Label>
                    <Input
                        id="description"
                        bind:value={newDepartment.description}
                        placeholder="Enter description"
                    />
                </div>
            </div>

            <Dialog.Footer>
                <Button variant="outline" onclick={() => showAddDialog = false}>
                    Cancel
                </Button>
                <Button onclick={handleAddDepartment} disabled={!newDepartment.name.trim()}>
                    Add Department
                </Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>

<!-- Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={showDeleteDialog}>
    <AlertDialog.Portal>
        <AlertDialog.Overlay />
        <AlertDialog.Content>
            <AlertDialog.Header>
                <AlertDialog.Title>Delete Department</AlertDialog.Title>
                <AlertDialog.Description>
                    Are you sure you want to delete "{departmentToDelete?.name}"? This action cannot be undone.
                    {#if departmentToDelete}
                        <br><br>
                        <strong>Note:</strong> You cannot delete a department that has existing schedules.
                    {/if}
                </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
                <AlertDialog.Cancel onclick={() => {
                    showDeleteDialog = false
                    departmentToDelete = null
                }}>
                    Cancel
                </AlertDialog.Cancel>
                <AlertDialog.Action onclick={handleDeleteDepartment} class="bg-red-600 hover:bg-red-700">
                    Delete
                </AlertDialog.Action>
            </AlertDialog.Footer>
        </AlertDialog.Content>
    </AlertDialog.Portal>
</AlertDialog.Root>
