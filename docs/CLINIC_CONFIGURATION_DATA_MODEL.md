# Clinic Configuration Data Model & Database Mapping

## 1. Schema Overview & Migration Status

The database is PostgreSQL hosted on Neon, managed through migration files in `apps/api/src/database/migrations/` and Prisma schema in `apps/api/src/database/prisma/schema.prisma`.

### Active Migrations
- **Migration `1.0.0`**: Initial multi-tenant schema (`api.clinics`, `api.users`, `api.patients`, `api.dentists`, `api.services`, `api.business_hours`, `api.appointments`, `api.schedule_blocks`, `api.conversations`, `api.messages`).
- **Migration `1.3.0` (`002_add_services_pricing_and_holiday_overrides.sql`)**:
  - Enhanced `api.services` with `price`, `currency`, `pricing_model`, `description`, `category`, and timestamps.
  - Created `api.clinic_holiday_overrides` with unique constraint `(clinic_id, holiday_date)`.
  - Added indexes for tenant-scoped lookups.
  - Recorded in `api.schema_migrations`.

---

## 2. Core Entities & Field Specifications

### A. Clinic (`api.clinics`)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Unique tenant identifier |
| `name` | `varchar(200)` | `NOT NULL` | Clinic business name |
| `slug` | `varchar(100)` | `NOT NULL, UNIQUE` | Unique URL-friendly slug |
| `timezone` | `varchar(50)` | `NOT NULL, DEFAULT 'America/New_York'` | IANA timezone (e.g. `America/Chicago`) |
| `locale` | `varchar(10)` | `NOT NULL, DEFAULT 'en-US'` | Locale code |
| `phone` | `varchar(30)` | `NULLABLE` | Primary clinic front desk phone |
| `email` | `varchar(255)` | `NULLABLE` | Official contact email |
| `active` | `boolean` | `NOT NULL, DEFAULT true` | Active/suspended tenant status |
| `settings` | `jsonb` | `NOT NULL, DEFAULT '{}'` | Operational settings (address, country, state, currency, receptionist config) |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Tenant creation timestamp |
| `updated_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Last update timestamp |

#### `settings` JSONB Subfields:
- `country`: Two-letter country code (e.g., `US`, `GB`, `CA`, `AU`, `IN`).
- `currency`: Default ISO currency code (e.g., `USD`, `GBP`, `CAD`, `AUD`, `INR`).
- `state`: State or Province (e.g., `TX`, `CA`, `ON`, `NSW`).
- `city`: Municipality (e.g., `Austin`, `London`).
- `address`: Street address (e.g., `123 Dental Way`).
- `postalCode`: Zip / Postal code.
- `receptionist`: AI Receptionist behavior (`enabled`, `tone`, `welcomeMessage`, `cancellationPolicyHours`).

---

### B. Services Catalog (`api.services`)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Service unique ID |
| `clinic_id` | `uuid` | `NOT NULL, FK -> api.clinics(id) ON DELETE CASCADE` | Tenant ownership foreign key |
| `name` | `varchar(150)` | `NOT NULL` | Treatment display name |
| `code` | `varchar(50)` | `NOT NULL` | Clinic-scoped procedure code |
| `category` | `varchar(100)` | `NULLABLE` | Category (e.g. Preventive, Restorative, Surgical, Cosmetic, Orthodontic) |
| `description` | `text` | `NULLABLE` | Patient and receptionist treatment details |
| `duration_minutes` | `integer` | `NOT NULL, CHECK (duration_minutes > 0)` | Operatory procedure time |
| `buffer_minutes` | `integer` | `NOT NULL, DEFAULT 0, CHECK (buffer_minutes >= 0)` | Turnover/sterilization buffer |
| `price` | `numeric(10, 2)` | `NULLABLE` | Service monetary price (null for quote_required) |
| `currency` | `varchar(10)` | `NOT NULL, DEFAULT 'USD'` | Currency code (USD, GBP, EUR, etc.) |
| `pricing_model` | `varchar(30)` | `NOT NULL, DEFAULT 'fixed'` | Pricing model (`fixed`, `starting_from`, `quote_required`) |
| `is_active` | `boolean` | `NOT NULL, DEFAULT true` | Availability for booking |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Creation timestamp |
| `updated_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Last update timestamp |

**Indexes & Constraints**:
- `CONSTRAINT uq_services_clinic_code UNIQUE (clinic_id, code)`: Service code unique per clinic.
- `INDEX idx_services_clinic_active ON api.services (clinic_id, is_active)`: High-performance booking query path.

---

### C. Operating Hours (`api.business_hours`)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Working hours record ID |
| `clinic_id` | `uuid` | `NOT NULL, FK -> api.clinics(id) ON DELETE CASCADE` | Tenant ownership foreign key |
| `day_of_week` | `smallint` | `NOT NULL, CHECK (day_of_week BETWEEN 0 AND 6)` | 0 = Sunday, 1 = Monday ... 6 = Saturday |
| `opens_at` | `time` | `NOT NULL` | Opening time in clinic local time |
| `closes_at` | `time` | `NOT NULL, CHECK (closes_at > opens_at)` | Closing time in clinic local time |

**Constraints**:
- `CONSTRAINT uq_business_hours_clinic_day UNIQUE (clinic_id, day_of_week)`: Exactly one operating rule per day of week per clinic.
- Unconfigured days are represented by the absence of a row. When present, the day is open during `[opens_at, closes_at]`.

---

### D. Clinic Holiday Overrides (`api.clinic_holiday_overrides`)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Override ID |
| `clinic_id` | `uuid` | `NOT NULL, FK -> api.clinics(id) ON DELETE CASCADE` | Tenant ownership foreign key |
| `holiday_date` | `date` | `NOT NULL` | Target date (`YYYY-MM-DD`) |
| `holiday_name` | `varchar(150)` | `NOT NULL` | National holiday name |
| `action` | `varchar(30)` | `NOT NULL, CHECK (action IN ('closed', 'working_day'))` | Desired policy for this clinic |
| `notes` | `text` | `NULLABLE` | Internal administrative note |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Creation timestamp |
| `updated_at` | `timestamptz` | `NOT NULL, DEFAULT now()` | Last update timestamp |

**Constraints**:
- `CONSTRAINT uq_clinic_holiday_override UNIQUE (clinic_id, holiday_date)`: One override per holiday date per clinic.
- `INDEX idx_holiday_overrides_clinic_date ON api.clinic_holiday_overrides (clinic_id, holiday_date)`: Fast availability check.

---

### E. Schedule Blocks & Custom Closures (`api.schedule_blocks`)
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | Closure/block ID |
| `clinic_id` | `uuid` | `NOT NULL, FK -> api.clinics(id) ON DELETE CASCADE` | Tenant ownership foreign key |
| `dentist_id` | `uuid` | `NULLABLE, FK -> api.dentists(id)` | Specific practitioner (or null for whole clinic) |
| `starts_at` | `timestamptz` | `NOT NULL` | Start timestamp (UTC) |
| `ends_at` | `timestamptz` | `NOT NULL, CHECK (ends_at > starts_at)` | End timestamp (UTC) |
| `reason` | `text` | `NULLABLE` | Reason (e.g. "Staff Training", "Equipment Repair") |
| `kind` | `varchar(50)` | `NOT NULL, DEFAULT 'closure'` | `holiday`, `closure`, `leave`, `maintenance` |

---

## 3. UI Field to Database & API Operations Mapping

| UI Section & Field | Database Column | API Operation | Validation Rules |
| :--- | :--- | :--- | :--- |
| **Settings: Practice Name** | `api.clinics.name` | `PATCH /api/v1/clinic` | String, 1-200 chars |
| **Settings: Timezone** | `api.clinics.timezone` | `PATCH /api/v1/clinic` | Valid IANA timezone |
| **Settings: Country** | `api.clinics.settings->country` | `PATCH /api/v1/clinic` | 2-letter country code |
| **Settings: Currency** | `api.clinics.settings->currency` | `PATCH /api/v1/clinic` | ISO currency code (3 chars) |
| **Settings: Address & City** | `api.clinics.settings->address,city`| `PATCH /api/v1/clinic` | String |
| **Services: Treatment Name**| `api.services.name` | `POST / PATCH /services`| 1-150 chars |
| **Services: Code** | `api.services.code` | `POST /services` | Unique per clinic |
| **Services: Pricing Model** | `api.services.pricing_model` | `POST / PATCH /services`| `fixed`, `starting_from`, `quote_required` |
| **Services: Price** | `api.services.price` | `POST / PATCH /services`| Numeric >= 0 or null if quote_required |
| **Services: Currency** | `api.services.currency` | `POST / PATCH /services`| 3 chars |
| **Services: Category** | `api.services.category` | `POST / PATCH /services`| String |
| **Hours: Open/Close Times** | `api.business_hours.opens_at, closes_at`| `PUT /schedules/clinic` | `closes_at > opens_at` |
| **Holidays: Working Day Toggle**| `api.clinic_holiday_overrides.action`| `PUT /schedules/holidays/override` | `closed` or `working_day` |
