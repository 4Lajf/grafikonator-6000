<script>
    import Card from '$lib/components/ui/card/card.svelte'
    import Button from '$lib/components/ui/button/button.svelte'
    import { user } from '$lib/auth.js'
</script>

<div class="space-y-6">
    <div>
        <h1 class="text-3xl font-bold text-gray-900">Scheduling Dashboard</h1>
        <p class="text-gray-600 mt-2">Welcome back, {$user?.email}! Streamline your team scheduling operations.</p>
    </div>

    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Individuals</h2>
            <p class="text-gray-600 mb-4">Add and manage team members</p>
            <Button href="/individuals">Manage Individuals</Button>
        </Card>

        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Departments</h2>
            <p class="text-gray-600 mb-4">Set up departments and rooms</p>
            <Button href="/departments">Manage Departments</Button>
        </Card>

        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Time Slots</h2>
            <p class="text-gray-600 mb-4">Generate 30-minute scheduling blocks</p>
            <Button href="/time-slots">Manage Time Slots</Button>
        </Card>

        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Availability</h2>
            <p class="text-gray-600 mb-4">Configure availability patterns</p>
            <Button href="/availability">Set Availability</Button>
        </Card>

        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Schedule</h2>
            <p class="text-gray-600 mb-4">View and manage schedules</p>
            <Button href="/schedule">View Schedule</Button>
        </Card>

        <Card class="p-6">
            <h2 class="text-xl font-semibold mb-3">Quick Start</h2>
            <div class="text-sm text-gray-600 space-y-2">
                <p>1. Add your team members</p>
                <p>2. Create departments and workspaces</p>
                <p>3. Generate time slots for scheduling</p>
                <p>4. Configure availability patterns</p>
                <p>5. Begin efficient scheduling</p>
            </div>
        </Card>
    </div>
</div>
