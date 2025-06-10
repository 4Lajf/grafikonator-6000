# Grafikonator 6000 - Scheduling App

A modern scheduling application built with SvelteKit, shadcn-svelte, and Supabase. This app helps you manage team scheduling with availability tiers and drag-and-drop functionality.

## Features

- **Individual Management**: Add and manage team members
- **Department Management**: Create departments/rooms
- **30-Minute Time Blocks**: Generate specific date-based scheduling slots (no recurring weekly patterns)
- **4-Tier Availability System**:
  - Tier 1: Highly Available
  - Tier 2: Available When Needed
  - Tier 3: Available Only If All Other Options Are Exhausted
  - Tier 4: Not Available Under Any Circumstance
- **Flexible Availability Patterns**: Set weekly recurring patterns with date-specific overrides
- **Auto-Scheduling**: Automatically assigns people based on availability tiers
- **Drag & Drop**: Manual schedule adjustments with validation
- **Conflict Prevention**: Ensures one person can't be in multiple departments simultaneously
- **User Authentication**: Secure login/signup with Supabase Auth
- **Row Level Security**: Data is protected and isolated per authenticated user

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Copy your project URL and anon key
3. Update the `.env` file with your credentials:

```env
PUBLIC_SUPABASE_URL=your_supabase_url_here
PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### 3. Set Up Database

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `database-schema.sql`
4. Run the SQL to create all necessary tables and sample data

### 4. Configure Authentication

1. In your Supabase dashboard, go to Authentication > Settings
2. Enable email authentication (enabled by default)
3. Optionally configure email templates and providers
4. The app uses Row Level Security (RLS) to protect data per user

### 5. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` to access the application.

## Usage Guide

### Getting Started

1. **Sign Up/Login**: Create an account or sign in with your email and password
2. **Add Individuals**: Go to the Individuals page and add your team members
3. **Create Departments**: Set up your departments/rooms in the Departments page
4. **Generate Time Slots**: Create 30-minute time blocks for the dates you want to schedule
5. **Set Availability Patterns**: Configure weekly recurring availability patterns for each person
6. **Schedule**: Use the Schedule page to view and manage assignments

### Scheduling Process

1. **Auto-Schedule**: Click "Auto Schedule" on any empty slot to automatically assign the best available person
2. **Manual Adjustments**: Drag and drop schedule cards to move assignments
3. **Validation**: The system prevents conflicts and respects availability tiers

### Availability Tiers

- **Tier 1 (Green)**: Person is highly available and will be prioritized
- **Tier 2 (Yellow)**: Person is available when needed
- **Tier 3 (Orange)**: Person is only available if all other options are exhausted
- **Tier 4 (Red)**: Person is not available under any circumstance

## Technology Stack

- **Frontend**: SvelteKit 5 with TypeScript
- **UI Components**: shadcn-svelte
- **Styling**: Tailwind CSS
- **Drag & Drop**: @neodrag/svelte
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (configured for authenticated users)

## Building for Production

```bash
npm run build
```
