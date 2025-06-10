-- Scheduling App Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Migration: Drop old availability tables if they exist
-- This handles the migration from weekly patterns to date-specific availability
DROP TABLE IF EXISTS availability_overrides CASCADE;
DROP TABLE IF EXISTS availability_patterns CASCADE;

-- Create departments table
CREATE TABLE departments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create individuals table
CREATE TABLE individuals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create time slots table (defines 30-minute time blocks for specific dates)
CREATE TABLE time_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true, -- Allow disabling specific time slots
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure no overlapping time slots on the same date
    UNIQUE(date, start_time)
);

-- Create availability table (defines individual availability for specific dates and times)
CREATE TABLE IF NOT EXISTS availability (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    individual_id UUID REFERENCES individuals(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    tier INTEGER NOT NULL CHECK (tier >= 1 AND tier <= 4), -- 1=highly available, 2=available when needed, 3=only if exhausted, 4=not available
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure no overlapping availability for the same person on the same date/time
    UNIQUE(individual_id, date, start_time)
);

-- Create schedules table (actual assignments)
CREATE TABLE schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    individual_id UUID REFERENCES individuals(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    time_slot_id UUID REFERENCES time_slots(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure one person can't be in multiple departments at the same time slot
    UNIQUE(individual_id, time_slot_id)
);

-- Create indexes for better performance
CREATE INDEX idx_time_slots_date ON time_slots(date);
CREATE INDEX idx_time_slots_date_time ON time_slots(date, start_time);
CREATE INDEX idx_availability_individual ON availability(individual_id);
CREATE INDEX idx_availability_date ON availability(date);
CREATE INDEX idx_availability_individual_date ON availability(individual_id, date);
CREATE INDEX idx_schedules_individual ON schedules(individual_id);
CREATE INDEX idx_schedules_department ON schedules(department_id);
CREATE INDEX idx_schedules_time_slot ON schedules(time_slot_id);

-- Enable Row Level Security (RLS)
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE individuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
-- These policies allow all operations for authenticated users only

CREATE POLICY "Allow all operations for authenticated users" ON departments
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow all operations for authenticated users" ON individuals
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow all operations for authenticated users" ON time_slots
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow all operations for authenticated users" ON availability
    FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow all operations for authenticated users" ON schedules
    FOR ALL USING (auth.uid() IS NOT NULL);

-- Note: Time slot generation is handled by the application
-- Use the Time Slot Manager in the application to generate 30-minute blocks
-- This approach is more reliable and provides better user control

-- Insert default departments
INSERT INTO departments (name, description) VALUES
    ('Reception', 'Front desk and customer service'),
    ('Kitchen', 'Food preparation and cooking'),
    ('Cleaning', 'Maintenance and cleaning duties'),
    ('Management', 'Administrative and supervisory tasks');

-- Time slots should be generated using the application's Time Slot Manager
-- This provides better control and user experience
