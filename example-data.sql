-- Example Data for Grafikonator 6000 Scheduling System
-- Run this in your Supabase SQL editor after setting up the schema
-- This will populate the database with diverse test data

-- Clear existing data (optional - uncomment if you want to start fresh)
-- DELETE FROM schedules;
-- DELETE FROM availability;
-- DELETE FROM time_slots;
-- DELETE FROM individuals;
-- DELETE FROM departments;

-- Insert Departments
INSERT INTO departments (name, description) VALUES
    ('Reception', 'Front desk, customer service, and visitor management'),
    ('Kitchen', 'Food preparation, cooking, and kitchen maintenance'),
    ('Cleaning', 'Facility maintenance, cleaning, and sanitation'),
    ('Management', 'Administrative tasks, supervision, and coordination'),
    ('Security', 'Building security, monitoring, and safety protocols'),
    ('IT Support', 'Technical support, system maintenance, and troubleshooting'),
    ('Warehouse', 'Inventory management, shipping, and receiving'),
    ('Customer Service', 'Phone support, complaint resolution, and client relations');

-- Insert Individuals with diverse backgrounds
INSERT INTO individuals (name, email, phone) VALUES
    ('Alice Johnson', 'alice.johnson@example.com', '+1-555-0101'),
    ('Bob Smith', 'bob.smith@example.com', '+1-555-0102'),
    ('Carol Davis', 'carol.davis@example.com', '+1-555-0103'),
    ('David Wilson', 'david.wilson@example.com', '+1-555-0104'),
    ('Emma Brown', 'emma.brown@example.com', '+1-555-0105'),
    ('Frank Miller', 'frank.miller@example.com', '+1-555-0106'),
    ('Grace Lee', 'grace.lee@example.com', '+1-555-0107'),
    ('Henry Taylor', 'henry.taylor@example.com', '+1-555-0108'),
    ('Ivy Chen', 'ivy.chen@example.com', '+1-555-0109'),
    ('Jack Anderson', 'jack.anderson@example.com', '+1-555-0110'),
    ('Kate Rodriguez', 'kate.rodriguez@example.com', '+1-555-0111'),
    ('Liam O''Connor', 'liam.oconnor@example.com', '+1-555-0112'),
    ('Maya Patel', 'maya.patel@example.com', '+1-555-0113'),
    ('Noah Kim', 'noah.kim@example.com', '+1-555-0114'),
    ('Olivia Thompson', 'olivia.thompson@example.com', '+1-555-0115'),
    ('Paul Martinez', 'paul.martinez@example.com', '+1-555-0116'),
    ('Quinn Foster', 'quinn.foster@example.com', '+1-555-0117'),
    ('Rachel Green', 'rachel.green@example.com', '+1-555-0118'),
    ('Sam Williams', 'sam.williams@example.com', '+1-555-0119'),
    ('Tina Zhang', 'tina.zhang@example.com', '+1-555-0120'),
    ('Uma Singh', 'uma.singh@example.com', '+1-555-0121'),
    ('Victor Lopez', 'victor.lopez@example.com', '+1-555-0122'),
    ('Wendy Clark', 'wendy.clark@example.com', '+1-555-0123'),
    ('Xavier Scott', 'xavier.scott@example.com', '+1-555-0124'),
    ('Yuki Tanaka', 'yuki.tanaka@example.com', '+1-555-0125');

-- Generate time slots for the next 14 days (8 AM to 8 PM, 30-minute intervals)
-- This creates a comprehensive schedule for testing
DO $$
DECLARE
    current_date_var DATE := CURRENT_DATE;
    end_date DATE := CURRENT_DATE + INTERVAL '14 days';
    slot_hour INTEGER;
    slot_minute INTEGER;
    start_time TIME;
    end_time TIME;
BEGIN
    WHILE current_date_var <= end_date LOOP
        -- Generate slots from 8 AM to 8 PM (24 slots per day)
        FOR slot_hour IN 8..19 LOOP
            FOR slot_minute IN 0..30 BY 30 LOOP
                start_time := (slot_hour || ':' || LPAD(slot_minute::TEXT, 2, '0') || ':00')::TIME;

                -- Calculate end time (30 minutes later)
                IF slot_minute = 30 THEN
                    end_time := ((slot_hour + 1) || ':00:00')::TIME;
                ELSE
                    end_time := (slot_hour || ':30:00')::TIME;
                END IF;

                -- Don't create the 8:00 PM slot (end time would be 8:30 PM)
                IF NOT (slot_hour = 19 AND slot_minute = 30) THEN
                    INSERT INTO time_slots (date, start_time, end_time, is_active)
                    VALUES (current_date_var, start_time, end_time, true);
                END IF;
            END LOOP;
        END LOOP;

        current_date_var := current_date_var + INTERVAL '1 day';
    END LOOP;
END $$;

-- Insert diverse date-specific availability for all individuals
-- Tier 1: Highly Available, Tier 2: Available When Needed, Tier 3: Only If Exhausted, Tier 4: Not Available

-- Generate availability for the next 14 days for all individuals
-- This creates realistic availability patterns based on individual preferences

-- Alice Johnson - Full-time worker, very flexible (weekdays 8-17, weekends 10-15)
DO $$
DECLARE
    alice_id UUID;
    current_date_var DATE := CURRENT_DATE;
    end_date DATE := CURRENT_DATE + INTERVAL '14 days';
    day_of_week INTEGER;
BEGIN
    SELECT id INTO alice_id FROM individuals WHERE name = 'Alice Johnson';

    WHILE current_date_var <= end_date LOOP
        day_of_week := EXTRACT(DOW FROM current_date_var); -- 0=Sunday, 1=Monday, etc.

        IF day_of_week BETWEEN 1 AND 5 THEN -- Monday to Friday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (alice_id, current_date_var, '08:00:00', '17:00:00', 1)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        ELSIF day_of_week IN (0, 6) THEN -- Saturday and Sunday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (alice_id, current_date_var, '10:00:00', '15:00:00', 2)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        END IF;

        current_date_var := current_date_var + INTERVAL '1 day';
    END LOOP;
END $$;

-- Bob Smith - Part-time, prefers mornings (Mon-Wed: 8-13 tier 1, Thu-Fri: 8-13 tier 2)
DO $$
DECLARE
    bob_id UUID;
    current_date_var DATE := CURRENT_DATE;
    end_date DATE := CURRENT_DATE + INTERVAL '14 days';
    day_of_week INTEGER;
BEGIN
    SELECT id INTO bob_id FROM individuals WHERE name = 'Bob Smith';

    WHILE current_date_var <= end_date LOOP
        day_of_week := EXTRACT(DOW FROM current_date_var);

        IF day_of_week BETWEEN 1 AND 3 THEN -- Monday to Wednesday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (bob_id, current_date_var, '08:00:00', '13:00:00', 1)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        ELSIF day_of_week BETWEEN 4 AND 5 THEN -- Thursday to Friday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (bob_id, current_date_var, '08:00:00', '13:00:00', 2)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        END IF;

        current_date_var := current_date_var + INTERVAL '1 day';
    END LOOP;
END $$;

-- Carol Davis - Evening shift worker (weekdays 14-20 tier 1, weekends 12-18 tier 2/3)
DO $$
DECLARE
    carol_id UUID;
    current_date_var DATE := CURRENT_DATE;
    end_date DATE := CURRENT_DATE + INTERVAL '14 days';
    day_of_week INTEGER;
BEGIN
    SELECT id INTO carol_id FROM individuals WHERE name = 'Carol Davis';

    WHILE current_date_var <= end_date LOOP
        day_of_week := EXTRACT(DOW FROM current_date_var);

        IF day_of_week BETWEEN 1 AND 5 THEN -- Monday to Friday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (carol_id, current_date_var, '14:00:00', '20:00:00', 1)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        ELSIF day_of_week = 6 THEN -- Saturday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (carol_id, current_date_var, '12:00:00', '18:00:00', 2)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        ELSIF day_of_week = 0 THEN -- Sunday
            INSERT INTO availability (individual_id, date, start_time, end_time, tier)
            VALUES (carol_id, current_date_var, '12:00:00', '18:00:00', 3)
            ON CONFLICT (individual_id, date, start_time) DO NOTHING;
        END IF;

        current_date_var := current_date_var + INTERVAL '1 day';
    END LOOP;
END $$;

-- Generate availability for all remaining individuals with diverse patterns
DO $$
DECLARE
    individual_record RECORD;
    current_date_var DATE;
    end_date DATE := CURRENT_DATE + INTERVAL '14 days';
    day_of_week INTEGER;
    pattern_type INTEGER;
BEGIN
    -- Loop through all individuals and create diverse availability patterns
    FOR individual_record IN
        SELECT id, name FROM individuals
        WHERE name NOT IN ('Alice Johnson', 'Bob Smith', 'Carol Davis')
    LOOP
        -- Assign a pattern type based on name hash for consistency
        pattern_type := (hashtext(individual_record.name) % 8) + 1;
        current_date_var := CURRENT_DATE;

        WHILE current_date_var <= end_date LOOP
            day_of_week := EXTRACT(DOW FROM current_date_var);

            CASE pattern_type
                WHEN 1 THEN -- Full-time flexible (like Maya Patel, Sam Williams)
                    IF day_of_week BETWEEN 1 AND 5 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '20:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '18:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 2 THEN -- Morning specialist (like Grace Lee, Rachel Green)
                    IF day_of_week BETWEEN 1 AND 5 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '14:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week = 6 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '12:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 3 THEN -- Evening specialist (like Frank Miller)
                    IF day_of_week BETWEEN 1 AND 5 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '12:00:00', '20:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week = 6 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '14:00:00', '20:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 4 THEN -- Weekend warrior (like David Wilson, Paul Martinez, Victor Lopez)
                    IF day_of_week BETWEEN 1 AND 5 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '17:00:00', '20:00:00', 3)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '20:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 5 THEN -- Student schedule (like Emma Brown, Noah Kim)
                    IF day_of_week IN (1, 3, 5) THEN -- Mon, Wed, Fri
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '09:00:00', '12:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '15:00:00', '18:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN -- Weekends
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '16:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 6 THEN -- Part-time mid-day (like Olivia Thompson, Wendy Clark)
                    IF day_of_week BETWEEN 1 AND 5 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '15:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week = 6 THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '09:00:00', '13:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 7 THEN -- Shift worker (like Jack Anderson, Xavier Scott)
                    IF day_of_week IN (1, 3, 5) THEN -- Alternating shifts
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '16:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (2, 4) THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '12:00:00', '20:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '18:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                WHEN 8 THEN -- Limited availability (like Liam O'Connor, Yuki Tanaka)
                    IF day_of_week IN (2, 4) THEN -- Tuesday, Thursday only
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '14:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN -- Weekends
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '08:00:00', '16:00:00', 1)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (1, 3, 5) THEN -- Other weekdays - emergency only
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '15:00:00', '19:00:00', 3)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;

                ELSE -- Default pattern for any unexpected pattern_type values
                    IF day_of_week BETWEEN 1 AND 5 THEN -- Monday to Friday
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '09:00:00', '17:00:00', 2)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    ELSIF day_of_week IN (0, 6) THEN -- Weekends
                        INSERT INTO availability (individual_id, date, start_time, end_time, tier)
                        VALUES (individual_record.id, current_date_var, '10:00:00', '16:00:00', 3)
                        ON CONFLICT (individual_id, date, start_time) DO NOTHING;
                    END IF;
            END CASE;

            current_date_var := current_date_var + INTERVAL '1 day';
        END LOOP;
    END LOOP;
END $$;

-- Add some specific availability overrides for special scenarios
-- These represent vacation days, sick days, special events, etc.

-- Alice Johnson has a doctor's appointment next Tuesday (override normal availability)
INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '2 days', '09:00:00', '11:00:00', 4
FROM individuals WHERE name = 'Alice Johnson'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

-- Bob Smith is on vacation for 3 days (not available)
INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '5 days', '08:00:00', '20:00:00', 4
FROM individuals WHERE name = 'Bob Smith'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '6 days', '08:00:00', '20:00:00', 4
FROM individuals WHERE name = 'Bob Smith'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '7 days', '08:00:00', '20:00:00', 4
FROM individuals WHERE name = 'Bob Smith'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

-- Carol Davis has extended availability for a special event
INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '3 days', '08:00:00', '20:00:00', 1
FROM individuals WHERE name = 'Carol Davis'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

-- Emma Brown has a class conflict (not available during normal hours)
INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '1 day', '14:00:00', '17:00:00', 4
FROM individuals WHERE name = 'Emma Brown'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

-- Maya Patel is not available for a family event
INSERT INTO availability (individual_id, date, start_time, end_time, tier)
SELECT id, CURRENT_DATE + INTERVAL '8 days', '12:00:00', '20:00:00', 4
FROM individuals WHERE name = 'Maya Patel'
ON CONFLICT (individual_id, date, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    tier = EXCLUDED.tier,
    updated_at = NOW();

-- Comments for usage
-- This data provides:
-- 1. 8 diverse departments for different business functions
-- 2. 25 individuals with varied date-specific availability patterns
-- 3. Time slots for 14 days (8 AM to 8 PM, 30-minute intervals)
-- 4. Diverse availability patterns across all 4 tiers
-- 5. Realistic availability overrides for specific dates
-- 6. Mix of full-time, part-time, student, and weekend workers
-- 7. Various shift preferences (morning, evening, night, weekend)
--
-- Key Changes in Date-Specific Availability:
-- - Replaced weekly recurring patterns with specific date availability
-- - Each individual has availability set for the next 14 days
-- - Patterns are generated based on individual preferences but for specific dates
-- - Special overrides show vacation days, appointments, and special events
--
-- To use this data:
-- 1. Run the main schema file first (database-schema.sql)
-- 2. Run this example data file
-- 3. Use the scheduling application to test auto-scheduling
-- 4. Try manual scheduling and see conflicts/availability
-- 5. Test different scenarios with the diverse workforce
-- 6. Add more availability as needed for future dates







-- Comments for usage
-- This data provides:
-- 1. 8 diverse departments for different business functions
-- 2. 25 individuals with varied availability patterns
-- 3. Time slots for 14 days (8 AM to 8 PM, 30-minute intervals)
-- 4. Diverse availability patterns across all 4 tiers
-- 5. Realistic availability overrides for specific dates
-- 6. Mix of full-time, part-time, student, and weekend workers
-- 7. Various shift preferences (morning, evening, night, weekend)
--
-- To use this data:
-- 1. Run the main schema file first (database-schema.sql)
-- 2. Run this example data file
-- 3. Use the scheduling application to test auto-scheduling
-- 4. Try manual scheduling and see conflicts/availability
-- 5. Test different scenarios with the diverse workforce
