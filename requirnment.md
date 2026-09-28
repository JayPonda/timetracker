# Personal Day Manager – Software Requirements Specification (SRS)

Sep 28, 2026 · @Jay

## 1. Introduction

Personal Day Manager (PDM) is a single-user, Docker-run web application that combines a Clockify-style time tracker, a task and project manager with mandatory acceptance-criteria closure, a calendar with daily events, and hourly and custom reminders. It runs only on the owner's laptop and keeps all data on local disk.

### 1.1 Purpose

This SRS defines what PDM must do, the rules it must enforce, the data it stores and the quality it must meet. It is written from a senior product-owner view so that the build can start from it without further guessing. Each requirement has an ID (for example FR-TIME-03) so it can be traced to a user story, a test and a release phase.

### 1.2 Business problem

At the office the user works on many tasks a day and must enter each task with its duration at the end of the day. Doing this from memory is slow and inaccurate. The user also wants to know where time went (by task, project, tag and phase), to stop closing tasks that do not meet their acceptance criteria, and to keep lessons and references for future work.

### 1.3 Goals

- G1: Record work time with one click (start / stop) so no end-of-day reconstruction is needed.
- G2: Show time per task, per day, per project, per tag and per phase (todo).
- G3: Enforce quality: a task cannot be ended without an acceptance-criteria check, and a missed criterion needs a written reason.
- G4: Plan the day with a calendar, events and reminders (hourly and custom).
- G5: Keep reference material and history searchable for future use.
- G6: Run isolated in Docker, keep data safe across restarts, and not disturb the laptop's current environment.

* G7: Let AI assistants search, report and create planning items and notes in PDM through an MCP server (get and create only), so the app works as a second brain; time tracking stays manual (section 14).

### 1.4 Scope

In scope: everything in sections 4 to 8, plus the MCP server in section 14, for one local user.

Out of scope for version 1: multiple users, login and roles, cloud sync, mobile apps, team sharing, invoicing or billing, integration with Jira, Google Calendar or Clockify (listed as future ideas in section 13).

### 1.5 Definitions

| Term | Meaning |
| --- | --- |
| Project | A container that groups many tasks (for example a client or product). |
| Task | A unit of work with name, description, up to 3 links, status, score, estimate, todos, acceptance criteria and reference materials. |
| Time entry | One start-to-stop span of tracked time on a task, optionally linked to a todo (phase) and carrying tags. |
| Todo | A step or phase inside a task. Time can be tracked against a todo. |
| Acceptance criterion (AC) | A checklist item that defines when a task is done. |
| Tag | A label on a time entry (for example meeting, coding, review) used to total time by activity type. |
| Lagging reason | Mandatory text explaining why a task ended with unmet acceptance criteria. |
| Reference material | A note or link stored on a task for future knowledge. |
| Reminder | A time-based alert shown to the user. |
| Score | A numeric value the user assigns to a task (for example complexity or priority points). |

### 1.6 Document conventions

The words must and shall mean mandatory; should means recommended; may means optional. Priorities use MoSCoW: Must, Should, Could, Won't (this release).

## 2. Overall description

### 2.1 Product perspective

PDM is a new standalone product. It replaces the user's habit of writing time entries by hand at the end of the day and combines what Clockify (time tracking), a calendar app (events), a reminder app and a task checklist tool would do separately.

### 2.2 User

One user: the laptop owner, an office worker who handles several tasks per day and reports duration per task. No login is needed in version 1 because the app is reachable only from the laptop itself (bound to localhost).

### 2.3 Operating environment

- Host: the user's laptop (OS not fixed; the design must work on Windows, macOS or Linux with Docker installed).
- Runtime: Docker containers started with Docker Compose; nothing else is installed on the host.
- Client: a modern desktop browser (Chrome, Edge, Firefox) opened at a localhost address.
- Network: no internet required for normal use.

### 2.4 Design constraints

- C1: Must run in Docker and not modify the host's existing environment (no global installs, no port clashes; the port must be configurable).
- C2: Data must persist across container restarts, rebuilds and laptop reboots.
- C3: Data must stay on the laptop; no external services.
- C4: Browser notifications and sound are the reminder channel, so the browser tab or a small always-open window must be available (see risk R2 in section 13).

### 2.5 Assumptions and dependencies

- A1: Docker Desktop (or Docker Engine) is already installed on the laptop.
- A2: The user works in one time zone; the laptop clock is the source of time.
- A3: The user allows browser notifications for the app's localhost address.
- A4: Only one timer runs at a time (like Clockify). This is a rule the user can confirm or change (open question Q1).
- A5: Working data volume is small (a few thousand tasks and tens of thousands of time entries over years), so a file database is enough.

### 2.6 Product functions at a glance

| Area | Summary |
| --- | --- |
| Time tracking | Start / stop a timer on a task and optionally on a todo; tags; totals per task, day, project, tag and phase. |
| Projects and tasks | Projects hold many tasks; each task has details, links, score, estimate, status. |
| Quality gate | Todos and acceptance criteria per task; closing requires AC review; unmet AC needs a lagging reason. |
| Calendar and events | Month, week and day views with events; daily agenda. |
| Reminders | Custom "remind me at" alerts and an hourly reminder. |
| Knowledge | Reference materials per task; search by keyword, project and timeline. |
| Operations | Dockerised, persistent, backed up, export and import. |

## 3. Architecture and Docker deployment

PDM runs as one application container plus a persistent data volume, started with a single `docker compose up -d` command.

&#91;embedded content: deployment view · 1 container, 1 volume\]

The browser talks only to the local container; the container writes to the volume, and a daily job copies the database to a backup folder on the host.

The MCP server (section 14) runs as one more small container, `pdm-mcp`, in the same Compose file; it calls the app's API and never touches the database file directly.

### 3.1 Proposed technology (changeable at design time)

| Layer | Proposal | Reason |
| --- | --- | --- |
| Frontend | React with TypeScript, built into static files | Rich calendar, timer and popup UI in the browser |
| Backend | Node.js with TypeScript (REST API) | One language across the stack, small image |
| Database | SQLite (single file) | No second container, easy backup, enough for one user |
| Scheduler | In-process job runner inside the backend | Fires reminders and the hourly alert; no extra service |
| Alerts | Browser Notifications API plus in-app popup and sound, pushed by server-sent events | Works offline on localhost |
| Packaging | Multi-stage Dockerfile and Docker Compose | Isolated from the laptop's current environment |

### 3.2 Deployment and persistence requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| DEP-01 | The app must start with `docker compose up -d` and stop with `docker compose down`, installing nothing on the host. | Must |
| DEP-02 | The port must be published on 127.0.0.1 only, default 8080, changeable in a `.env` file to avoid clashes. | Must |
| DEP-03 | The database file must live on a volume (default: host folder `./data`) so data survives stop, restart, rebuild and image update. | Must |
| DEP-04 | The container must use `restart: unless-stopped` so it comes back after a laptop reboot. | Must |
| DEP-05 | Time zone must be set with the `TZ` variable, default the laptop's zone. | Must |
| DEP-06 | A `/health` endpoint must report app and database status for the Docker health check. | Should |
| DEP-07 | A daily automatic backup of the database must go to `./backups`, keeping the last 14 copies (configurable), plus a manual Backup now button in Settings. | Must |
| DEP-08 | The user must be able to export all data (JSON, and CSV for time entries) and import a previous export. | Should |
| DEP-09 | Schema migrations must run automatically at start, take a backup first, and never delete user data. | Must |
| DEP-10 | The app process must run as a non-root user inside the container. | Should |
| DEP-11 | Removing the app must be one step: `docker compose down` (keep data) or `docker compose down -v` plus deleting `./data` (remove data). | Should |

### 3.3 Illustrative Compose file

```yaml
services:
  pdm:
    build: .
    container_name: pdm-app
    restart: unless-stopped
    ports:
      - "127.0.0.1:${PDM_PORT:-8080}:8080"
    environment:
      - TZ=${TZ:-Asia/Kolkata}
    volumes:
      - ./data:/data
      - ./backups:/backups
```

## 4. Functional requirements: time tracking

The user starts a timer on a task, stops it, and the app records a time entry. Every entry can point to a todo (the phase) and carry tags, so time can be totalled by task, day, project, tag and phase.

### 4.1 Timer

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TIME-01 | The user must be able to start a timer on any task that is not ended, from the task page, the task list, the global top bar or a keyboard shortcut. | Must |
| FR-TIME-02 | When starting, the user may pick a todo of that task (the phase being worked on) and may add tags; both can also be set or changed while the timer runs. | Must |
| FR-TIME-03 | The user must be able to stop the running timer with one click; stopping creates a time entry with start time, end time and duration. | Must |
| FR-TIME-04 | Only one timer may run at once. Starting a new timer must stop the running one first (asking for confirmation, with an option to always switch automatically). | Must |
| FR-TIME-05 | A running timer must be always visible in a top bar showing task name, project, todo, tags and a live elapsed clock (HH:MM:SS) on every screen. | Must |
| FR-TIME-06 | A running timer must survive page refresh, browser close and container restart, because the start time is stored in the database, not in the browser. | Must |
| FR-TIME-07 | Starting a timer on an Open task must change its status to In progress automatically. | Must |
| FR-TIME-08 | The user should be able to pause and resume; a pause ends the current entry and resume starts a new entry with the same task, todo and tags. | Should |
| FR-TIME-09 | If the timer has been running for a set limit (default 4 hours, configurable) the app should ask "Still working?" to catch a forgotten timer. | Should |
| FR-TIME-10 | On start-up after a crash or restart, the app must show a running timer with its true elapsed time and allow the user to stop it at now or at a chosen earlier time. | Should |

### 4.2 Time entries

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TIME-11 | Each time entry must store: task, optional todo (phase), start, end, duration, tags, optional note and a source (timer or manual). | Must |
| FR-TIME-12 | The user must be able to see all time entries of a task, newest first, with each entry's date, start, end, duration, todo, tags and note. | Must |
| FR-TIME-13 | The task page must show the total tracked time for the task and the total per todo and per tag. | Must |
| FR-TIME-14 | The user must be able to add a manual entry (task, date, start, end or duration) for work done without the timer. | Must |
| FR-TIME-15 | The user must be able to edit any entry (start, end, todo, tags, note) and to archive an entry made by mistake; entries are never deleted. Totals must recalculate immediately, and archived entries are left out of totals. | Must |
| FR-TIME-16 | The app must reject an entry where end is before start and must warn when entries overlap in time (the user may still save). | Must |
| FR-TIME-17 | Entries that cross midnight must be stored as one entry and split by day in daily reports. | Should |
| FR-TIME-18 | Durations must be shown as HH:MM (and optionally decimal hours) and be rounded consistently (default: to the second stored, shown to the minute). | Must |

### 4.3 Tags on time entries

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TAG-01 | The user must be able to create, rename, colour and archive tags in a tag manager, and create a tag on the fly while typing on an entry. | Must |
| FR-TAG-02 | An entry may have zero or many tags. | Must |
| FR-TAG-03 | For any task the user must be able to see time spent per tag (for example coding 3h 10m, meeting 45m) as a table and a chart. | Must |
| FR-TAG-04 | The user must be able to see time per tag across a project, a date range or all work. | Must |
| FR-TAG-05 | A tag must never be deleted; the user archives it. An archived tag is hidden from pickers but stays on existing entries, so per-tag totals do not change. | Must |
| FR-TAG-06 | Tags may be edited later on many entries at once (bulk add or remove tag). | Could |

### 4.4 Phase tracking (timeline of a task)

A phase is a todo of the task. When the user starts the timer they pick the todo, so the app knows which phase the time belongs to.

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PHASE-01 | Every task must show a timeline listing its todos in order with time spent on each, the first and last time worked, and status (done or not). | Must |
| FR-PHASE-02 | Time tracked without choosing a todo must appear under "No phase" so nothing is lost. | Must |
| FR-PHASE-03 | The timeline must show a bar per phase sized by time spent, and a sequence view of when each phase was worked on (date and time ranges). | Should |
| FR-PHASE-04 | Comparing estimate to actual per task (and per todo when a todo estimate is given) must be shown, with over-run highlighted. | Should |
| FR-PHASE-05 | A todo must never be deleted; the user archives it. An archived todo stays linked to its time entries, so phase totals do not change. | Must |

## 5. Functional requirements: projects and tasks

A project holds many tasks; a task holds everything about one piece of work. Every task moves through three statuses: Open, In progress, Ended.

### 5.1 Projects

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-PRJ-01 | The user must be able to create a project with name, optional description and colour. | Must |
| FR-PRJ-02 | A project must contain many tasks; a task belongs to exactly one project (or to a built-in "No project" bucket if the user chooses none). | Must |
| FR-PRJ-03 | The user must be able to edit, archive and restore a project. Archived projects are hidden from pickers but keep their history. | Must |
| FR-PRJ-04 | A project must never be deleted; the user archives it. Archiving hides the project and its tasks from pickers and default lists but keeps every task, time entry and history, and the user can restore it. | Must |
| FR-PRJ-05 | A project page must show its tasks by status, total time, time per tag, time per task, and total score and estimated hours against actual hours. | Must |
| FR-PRJ-06 | A task must be movable to another project; its time entries move with it. | Should |

### 5.2 Task fields

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TASK-01 | A task must have a name (required, up to 200 characters). | Must |
| FR-TASK-02 | A task must have a description (optional, long text, with basic formatting such as bold, lists and links). | Must |
| FR-TASK-03 | A task must allow up to 3 links; each link has an optional label and a URL. The app must refuse a fourth link and validate URL format. | Must |
| FR-TASK-04 | A task must belong to a project (see FR-PRJ-02). | Must |
| FR-TASK-05 | A task must have a status: Open, In progress or Ended (section 5.3). | Must |
| FR-TASK-06 | A task must have a score (number, for example 0 to 100 or story points; the scale is a setting) and an estimation in hours (decimal, for example 2.5). | Must |
| FR-TASK-07 | A task should have an optional due date and an optional planned start date. | Should |
| FR-TASK-08 | A task must record created date, started date (first timer or first move to In progress), ended date and last updated date automatically. | Must |
| FR-TASK-09 | A task must have a todo list, an acceptance-criteria checklist and reference materials (sections 6 and 8). | Must |
| FR-TASK-10 | A task must show its total time, time entries, per-tag totals and phase timeline (section 4). | Must |
| FR-TASK-11 | A task must show estimate versus actual time, with a clear over-run or under-run figure once it has entries. | Must |
| FR-TASK-12 | The user must be able to edit all fields at any time. Editing an Ended task must be allowed but must be recorded in the task history. | Must |
| FR-TASK-13 | A task must never be deleted; the user archives it. An archived task is hidden from default lists and pickers, cannot run a timer, keeps all its time entries and history, and can be restored. | Must |
| FR-TASK-14 | The user should be able to duplicate a task (with its todos and acceptance criteria, without time entries). | Could |

### 5.3 Status lifecycle

| From | To | Trigger | Rule |
| --- | --- | --- | --- |
| Open | In progress | Timer started, or the user moves it | Automatic on first timer start (FR-TIME-07). |
| In progress | Open | The user moves it back | Allowed; keeps all entries. |
| In progress or Open | Ended | The user clicks End task | Must pass the closure gate in section 6.3. A task cannot skip the gate. |
| Ended | In progress | The user reopens it | Allowed; the previous closure result is kept in history. |

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-STAT-01 | A task must never reach Ended by any route (button, drag and drop, bulk action, edit form, import) without completing the closure gate. | Must |
| FR-STAT-02 | Ending a task must stop its running timer first (saving the entry). | Must |
| FR-STAT-03 | The user must not be able to start a timer on an Ended task until it is reopened. | Must |
| FR-STAT-04 | Task lists and boards must be filterable and groupable by status, and show the status with a colour and label. | Must |
| FR-STAT-05 | Every status change must be logged with date and time in the task history. | Should |

### 5.4 Task list and board views

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-VIEW-01 | A task list view must show name, project, status, score, estimate, actual time, due date and a Start button per row. | Must |
| FR-VIEW-02 | A board view (columns Open, In progress, Ended) should let the user drag a card between Open and In progress; dragging to Ended must open the closure gate. | Should |
| FR-VIEW-03 | The list must support sorting (name, date, score, time, estimate) and filtering (project, status, tag, date range). | Must |

## 6. Functional requirements: todos, acceptance criteria and the closure gate

No task can be ended until the user has reviewed its acceptance criteria. If any criterion is not met, the user must explain why the task is lagging.

### 6.1 Todo list (phases)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-TODO-01 | The user must be able to create a todo list for any task: add, rename, reorder (drag and drop), tick done or not done, and archive todos. | Must |
| FR-TODO-02 | A todo must have a title, an optional note, a done flag with completed date, and an optional estimate in hours. | Must |
| FR-TODO-03 | The user must be able to edit the todo list at any time, including on an Ended task (logged in history). | Must |
| FR-TODO-04 | The task page must show todo progress (for example 3 of 5 done) and time spent per todo. | Must |
| FR-TODO-05 | The timer must offer the task's todos as a selection so time is tracked against a phase (FR-TIME-02). | Must |
| FR-TODO-06 | Ticking every todo must not by itself end the task; ending always goes through the closure gate. The app may suggest "All todos done, end task?". | Must |
| FR-TODO-07 | Sub-todos (one level) could be supported. | Could |

### 6.2 Acceptance criteria checklist

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-AC-01 | The user must be able to add, edit, reorder and archive acceptance criteria (AC) on any task, before or after work starts. Archived criteria are not listed in later closures but stay in past closure records. | Must |
| FR-AC-02 | Each criterion is a short text statement that is either met or not met at closure time. | Must |
| FR-AC-03 | The AC checklist must be visible on the task page next to the todo list and clearly separate from it. | Must |
| FR-AC-04 | Editing or archiving a criterion after a closure attempt must be recorded in history so the closure record stays truthful. | Should |
| FR-AC-05 | A task with no acceptance criteria must not be endable (see FR-GATE-02). | Must |
| FR-AC-06 | The user may reuse a saved AC template (a named set of criteria) when creating a task. | Could |

### 6.3 Closure gate

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-GATE-01 | Clicking End task must always open a popup titled with the task name, listing every acceptance criterion with a checkbox, all unchecked by default. | Must |
| FR-GATE-02 | If the task has no acceptance criteria, the popup must tell the user to add at least one and offer an Add criteria action; the task stays open. | Must |
| FR-GATE-03 | The popup must offer Confirm closure and Cancel. Cancel leaves the task unchanged. | Must |
| FR-GATE-04 | If all criteria are ticked, Confirm closure ends the task and stores the result as Fulfilled. | Must |
| FR-GATE-05 | If one or more criteria are not ticked, a mandatory field "Why is this task lagging?" must appear. Confirm closure must stay disabled until the user enters a reason (minimum 10 characters, configurable). The result is stored as Not fulfilled with the unmet criteria and the reason. | Must |
| FR-GATE-06 | The popup must show the task's summary while deciding: total time, estimate, over-run and todo progress. | Should |
| FR-GATE-07 | Each closure must be saved as a closure record: date and time, criteria with met or not-met state, lagging reason, total time and estimate at closure. | Must |
| FR-GATE-08 | The gate must be enforced in the backend as well as the interface; an API call to end a task without a valid closure payload must be refused. | Must |
| FR-GATE-09 | When a task is reopened and ended again, a new closure record must be added; earlier records stay visible. | Must |
| FR-GATE-10 | The closure popup should have a keyboard-friendly layout (Space to tick, Enter to confirm when valid, Esc to cancel). | Could |

Closure steps in order:

1. The user clicks End task.
2. If a timer is running on the task, it stops and its entry is saved.
3. The popup lists the acceptance criteria; the user ticks those that are met.
4. All ticked: the user confirms and the task becomes Ended (Fulfilled).
5. Not all ticked: the lagging-reason box appears; the user writes the reason and confirms; the task becomes Ended (Not fulfilled) with the reason saved.
6. Cancel at any point leaves the task In progress and keeps the saved timer entry.

### 6.4 Lagging and quality reporting

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-LAG-01 | The user must be able to list all tasks closed as Not fulfilled with their lagging reasons, filterable by project and date. | Must |
| FR-LAG-02 | A task's closure result and lagging reason must be shown on its page and in search results. | Must |
| FR-LAG-03 | A summary should show the fulfilled versus not-fulfilled ratio per week, month and project. | Could |

## 7. Functional requirements: calendar, daily events and reminders

### 7.1 Calendar and daily events

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-CAL-01 | The app must provide month, week and day calendar views, with Today and previous / next navigation and a date picker. | Must |
| FR-CAL-02 | The user must be able to create, edit and archive events with title, date, start time, end time or all-day flag, optional description, optional location or link, colour and optional linked task or project. | Must |
| FR-CAL-03 | Events must support repeat rules: none, daily, weekly (chosen weekdays), monthly, and an end date; editing a repeating event must ask whether the change applies to this one, this and following, or all. | Should |
| FR-CAL-04 | Each event may have one or more reminders (for example at start, 10 minutes before, 1 hour before). | Must |
| FR-CAL-05 | Time entries must appear on the day and week calendar as blocks (read-only, click to open the entry) so the user sees planned and actual time together; the user can hide them. | Should |
| FR-CAL-06 | Task due dates and planned start dates should appear on the calendar. | Should |
| FR-CAL-07 | A Today page must show the daily agenda: events in time order, reminders due today, tasks due today, the running timer, and time tracked so far today. | Must |
| FR-CAL-08 | Creating an event by clicking or dragging on an empty slot of the week or day view must open a quick-create form. | Should |
| FR-CAL-09 | Events must be draggable to change date or time, and resizable to change duration, in week and day views. | Could |
| FR-CAL-10 | The app must warn when a new event overlaps another event but still allow saving. | Should |
| FR-CAL-11 | The week starts on Monday by default, changeable to Sunday in settings. | Should |

### 7.2 Reminders

There are two kinds: hourly reminders and custom ("remind me at") reminders.

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-REM-01 | The user must be able to create a reminder with title, optional note, date and time ("Remind me at"), and optional linked task or event. | Must |
| FR-REM-02 | A reminder may repeat: none, daily, weekly, weekdays only, monthly, or every N hours or days. | Should |
| FR-REM-03 | When a reminder is due, the app must show an in-app popup and a browser notification with sound, with actions Done, Snooze (5, 10, 30 minutes or custom) and Open task. | Must |
| FR-REM-04 | The user must be able to edit, disable, archive and list reminders, with tabs Upcoming, Done and Missed. | Must |
| FR-REM-05 | Hourly reminder: the app must send a reminder at the top of every hour (or at a chosen minute) within configurable working hours (default 09:00 to 18:00, days Monday to Friday). | Must |
| FR-REM-06 | The hourly reminder must show what is running: task, todo and elapsed time, or a clear warning "No timer running" with a Start button and a list of recent tasks to resume. | Must |
| FR-REM-07 | The hourly reminder must offer a quick note ("What did you do this hour?") that is saved to the running entry, or to a new entry if none is running. | Should |
| FR-REM-08 | The user must be able to turn the hourly reminder on or off, change its working hours and days, choose sound on or off, and pause it for today. | Must |
| FR-REM-09 | Reminders that fire while the browser is closed or the laptop is asleep must appear as Missed on the next open, with the original time shown. | Must |
| FR-REM-10 | A reminder must not fire twice for the same occurrence, including after a restart or when two browser tabs are open. | Must |
| FR-REM-11 | The app should offer reminders for tasks: at a chosen time, and before the due date. | Should |
| FR-REM-12 | At the end of the working day (default 18:00) the app could remind the user to review today's entries and any tasks still In progress. | Could |

### 7.3 Notification behaviour

- The user grants browser notification permission once; Settings must show the permission state and a Test notification button (FR-REM-13, Must).
- If notifications are blocked, the app must fall back to an in-app banner and sound, and tell the user how to enable notifications (FR-REM-14, Must).
- Reminder timing accuracy: a reminder must show within 30 seconds of its due time while the app is open (NFR-PERF-04).
- Reminders are checked by the backend scheduler, so they are not lost if the page is reloaded.

## 8. Functional requirements: reference materials, search, day view and reports

### 8.1 Reference materials

Reference materials keep knowledge the user may need later: a lesson learned, a command, a decision, a useful link.

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-REF-01 | Each task must have a Reference materials section where the user can add, edit and archive items. | Must |
| FR-REF-02 | A reference item must have a title, a body (text with basic formatting and code blocks), optional URL and optional type (note, link, snippet, lesson learned, decision). | Must |
| FR-REF-03 | Reference items must be searchable (section 8.2) and shown in search results with their task and project. | Must |
| FR-REF-04 | The user should be able to view all reference items across all tasks in one library, filtered by project, type and keyword. | Should |
| FR-REF-05 | Reference items must stay available after a task is Ended or archived. | Must |
| FR-REF-06 | The user could attach local files (small documents or images) to a reference item, stored on the data volume. | Could |

### 8.2 Search

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-SRCH-01 | A global search box (shortcut Ctrl+K) must search by keyword across task name, description, links, todos, acceptance criteria, lagging reasons, reference materials, time entry notes, projects, tags and events. | Must |
| FR-SRCH-02 | The user must be able to narrow results with filters: project, status, tag, closure result, and a timeline (date range, with presets Today, Yesterday, This week, This month, Custom). | Must |
| FR-SRCH-03 | The date-range filter must apply, at the user's choice, to task created, started, ended or due date, or to when time was worked. | Should |
| FR-SRCH-04 | Results must show the matching text highlighted, the task's project and status, and total time, and open the task on click. | Must |
| FR-SRCH-05 | Search must be case-insensitive, match partial words, and return the first page of results in under 1 second for the expected data volume. | Must |
| FR-SRCH-06 | Search results should be sortable by relevance, date and time spent. | Should |
| FR-SRCH-07 | The user could save a search as a named filter. | Could |

### 8.3 Work log for any day

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-DAY-01 | The user must be able to pick any date and see which tasks were worked on that day, each with its time entries and total time, and the day's grand total. | Must |
| FR-DAY-02 | The day view must group by task (default), and optionally by project, todo or tag, and show the tag totals for the day. | Must |
| FR-DAY-03 | The user must be able to copy the day's summary (task, duration, description) as text in a format ready to paste into the office timesheet. | Must |
| FR-DAY-04 | The day view must allow editing entries in place and adding a manual entry for that date. | Must |
| FR-DAY-05 | The day view should show tasks that changed status that day (started, ended) and events of the day. | Should |
| FR-DAY-06 | Previous day and next day navigation and a week strip with daily totals should be available. | Should |

### 8.4 Reports

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-RPT-01 | The user must be able to see total time for a chosen period grouped by project, task, tag or phase (todo), as a table and a chart. | Must |
| FR-RPT-02 | A report must combine filters: date range, project, tag, task status. | Must |
| FR-RPT-03 | The app must show estimate versus actual hours per task, project and period, and total score for ended tasks. | Should |
| FR-RPT-04 | Reports must be exportable to CSV, and printable. | Should |
| FR-RPT-05 | A weekly summary (hours per day, top projects, top tags, tasks ended, tasks lagging) should be available. | Should |
| FR-RPT-06 | A dashboard on the home page could show today's hours, this week's hours, running timer, next reminder and next event. | Could |

## 9. Data model

The model has 15 entities. All records carry an id, created time and updated time. Times are stored in UTC and shown in the user's time zone.

### 9.1 Entities and key fields

| Entity | Key fields | Notes |
| --- | --- | --- |
| Project | name, description, colour, archived | Has many Tasks |
| Task | project, name, description, status (open, in\_progress, ended), score, estimate\_hours, planned\_start, due\_date, started\_at, ended\_at, archived | Belongs to one Project |
| TaskLink | task, label, url, position (1 to 3) | Maximum 3 per task, enforced in the database and API |
| Todo | task, title, note, done, done\_at, estimate\_hours, position | Acts as the phase of a task |
| AcceptanceCriterion | task, text, position | Definition of done for a task |
| ClosureRecord | task, closed\_at, result (fulfilled, not\_fulfilled), lagging\_reason, total\_seconds, estimate\_hours | One per closure; reopening adds a new one |
| ClosureCriterionResult | closure\_record, criterion\_text, met | Snapshot of each criterion at closure time |
| TimeEntry | task, todo (optional), started\_at, ended\_at (null while running), duration\_seconds, note, source (timer or manual) | At most one row with ended\_at null |
| Tag | name, colour | Unique name |
| TimeEntryTag | time\_entry, tag | Many-to-many link |
| ReferenceMaterial | task, title, body, url, type | Kept after task ends |
| CalendarEvent | title, description, location, start, end, all\_day, colour, repeat\_rule, task or project (optional) | Repeats expanded when displayed |
| Reminder | title, note, remind\_at, repeat\_rule, status (upcoming, done, missed, snoozed), task or event (optional), last\_fired\_at | Also used for event reminders |
| Setting | key, value | Hourly reminder hours and days, score scale, backup count, week start, long-timer limit, time zone |
| ActivityLog | entity, entity\_id, action, before, after, at | Task history: status changes, edits after closure |

### 9.2 Relationships

- One Project has many Tasks; one Task belongs to one Project (or to the built-in No project).
- One Task has many Todos, AcceptanceCriteria, ReferenceMaterials, TimeEntries, ClosureRecords and up to 3 TaskLinks.
- One TimeEntry belongs to one Task and optionally to one Todo; it has many Tags through TimeEntryTag.
- One ClosureRecord has many ClosureCriterionResults.
- A Reminder and a CalendarEvent may each point at a Task.

### 9.3 Data rules

| ID | Rule | Priority |
| --- | --- | --- |
| DATA-01 | A task may have at most 3 links; the database must reject a fourth. | Must |
| DATA-02 | Only one time entry may have an empty end time at any moment. | Must |
| DATA-03 | A task with status ended must have at least one ClosureRecord, and a Not fulfilled record must have a non-empty lagging reason. | Must |
| DATA-04 | Total time for a task must be calculated from its time entries (never stored separately) so it cannot drift. | Must |
| DATA-05 | Removing a todo means archiving it; its time entries keep their link to it. | Must |
| DATA-06 | Archiving a task, project or tag must follow the rules in FR-TASK-13, FR-PRJ-04 and FR-TAG-05. | Must |
| DATA-07 | Durations must be stored in whole seconds. | Must |
| DATA-08 | All writes that change several tables (for example ending a task) must run in one database transaction. | Must |

No-delete policy (data rules):

- DATA-09 (Must): The application and its API must have no delete operation for user data. Removal means setting `archived_at`; every removable entity (project, task, todo, acceptance criterion, time entry, tag, reference material, event, reminder) carries this field.
- DATA-10 (Must): The database must block hard deletes of user data (no cascading deletes, and a rule that refuses DELETE on these tables), so a bug cannot erase data.
- DATA-11 (Must): Archived items are left out of pickers, default lists and current totals, appear in search only when Show archived is on, keep all their history, and can be restored by the user.
- DATA-12 (Must): The amount excluded by archived time entries must be shown, so nothing is hidden silently.
- DATA-13 (Must): Import must only add or merge records, never overwrite or remove existing ones.

## 10. User interface requirements

The interface must let the user start work in two clicks and keep the timer in view at all times.

### 10.1 Screens

| Screen | Purpose | Main content |
| --- | --- | --- |
| Today | Home page and daily agenda | Running timer, quick-start box, today's events, reminders due, tasks due, entries so far, total hours today |
| Timer bar (all pages) | Always-visible control | Task picker, todo picker, tag picker, Start / Stop, live clock |
| Tasks | List and board of tasks | Filters, sort, Start button per row, status chips, New task |
| Task detail | Everything about one task | Fields, up to 3 links, todos, acceptance criteria, reference materials, time entries, per-tag and per-phase totals, phase timeline, closure history, activity history |
| Projects | Project list and project page | Task counts by status, time, tags, estimate versus actual |
| Calendar | Month, week and day views | Events, entries as blocks, due dates, quick create |
| Day log | Any-day work log | Date picker, entries grouped by task, totals, copy-for-timesheet |
| Reminders | Manage reminders | Upcoming, Done, Missed tabs; hourly reminder settings |
| Reports | Time analysis | Filters, group by project, task, tag or phase, chart and table, CSV export |
| Library | All reference materials | Search and filters |
| Settings | Configuration | Hourly reminder hours, notifications test, score scale, week start, backup and export, long-timer limit, theme |

### 10.2 Popups and dialogs

| ID | Requirement | Priority |
| --- | --- | --- |
| UI-01 | The closure popup must follow FR-GATE-01 to FR-GATE-10 and must block interaction with the page until confirmed or cancelled. | Must |
| UI-02 | The reminder popup must show title, time, linked task, and buttons Done, Snooze and Open task. | Must |
| UI-03 | The hourly popup must show the running task with elapsed time or the "No timer running" warning (FR-REM-06). | Must |
| UI-04 | There are no delete actions. Archive actions must ask for confirmation and say what will be hidden; archived items can be restored. | Must |
| UI-05 | The forgotten-timer prompt (FR-TIME-09) must offer Keep running, Stop now and Stop at a chosen time. | Should |
| UI-06 | An Undo toast should appear for 10 seconds after archiving an entry, todo or reminder. | Should |

### 10.3 General UI requirements

- UI-07 (Must): Keyboard shortcuts for start / stop (for example Ctrl+Space), global search (Ctrl+K), new task (N) and new reminder (R), all listed on a help panel.
- UI-08 (Must): Every form must show clear validation messages, keep typed input on error, and mark required fields.
- UI-09 (Should): Light and dark theme, following the operating system by default.
- UI-10 (Should): A responsive layout that works from a half-width laptop window to full screen; phone layout is not required.
- UI-11 (Should): Autosave of long text (description, notes) as a draft so a browser crash does not lose input.
- UI-12 (Must): Status and result colours must not be the only signal; each also carries a text label (accessibility).
- UI-13 (Should): The browser tab title shows the running timer and the task name, so the timer is visible from another tab.

* UI-17 (Must): Every list has a Show archived toggle and a Restore action; there is no Delete button anywhere in the app.

## 11. Non-functional requirements and business rules

### 11.1 Non-functional requirements

| ID | Category | Requirement | Priority |
| --- | --- | --- | --- |
| NFR-PERF-01 | Performance | Pages must load in under 2 seconds and common actions (start, stop, save) must respond in under 300 ms on the laptop. | Must |
| NFR-PERF-02 | Performance | The app must stay responsive with 5,000 tasks and 100,000 time entries. | Should |
| NFR-PERF-03 | Performance | Idle resource use must stay small: under 300 MB memory and negligible CPU while idle. | Should |
| NFR-PERF-04 | Performance | Reminders must show within 30 seconds of their due time while the app is open. | Must |
| NFR-REL-01 | Reliability | No committed data may be lost on a container stop, crash or power loss; the database must use write-ahead logging and transactions. | Must |
| NFR-REL-02 | Reliability | The running timer and due reminders must be recovered after restart (FR-TIME-06, FR-REM-09). | Must |
| NFR-REL-03 | Reliability | Backups must be verifiable: a restore procedure must be documented and tested. | Must |
| NFR-SEC-01 | Security | The app must listen on the loopback address only and not be reachable from other devices on the network. | Must |
| NFR-SEC-02 | Security | User input must be validated and escaped on server and client to prevent injection and script attacks (for example in task descriptions and links). | Must |
| NFR-SEC-03 | Security | Links must accept only http and https schemes. | Must |
| NFR-SEC-04 | Security | The container must run as a non-root user with no extra privileges and no host mounts other than data and backups. | Should |
| NFR-SEC-05 | Security | An optional local PIN or password could lock the app for privacy at the office. | Could |
| NFR-PRIV-01 | Privacy | All data must remain on the laptop; the app must make no outgoing network calls and use no analytics or external fonts, scripts or services. | Must |
| NFR-USE-01 | Usability | A new user must be able to start a timer within 2 clicks from the Today page and end a task without instructions. | Must |
| NFR-USE-02 | Usability | The interface must use plain labels and consistent terms (Task, Todo, Acceptance criteria, Tag, Reference). | Should |
| NFR-MAINT-01 | Maintainability | Code must have automated tests for business rules (timer, totals, closure gate, reminders) with at least 80% coverage on those modules. | Should |
| NFR-MAINT-02 | Maintainability | Database changes must use versioned migrations. | Must |
| NFR-MAINT-03 | Maintainability | A README must explain install, start, stop, backup, restore, upgrade and removal. | Must |
| NFR-PORT-01 | Portability | The same Docker setup must work on Windows, macOS and Linux hosts. | Should |
| NFR-COMP-01 | Compatibility | Latest two versions of Chrome, Edge and Firefox must be supported. | Should |
| NFR-TIME-01 | Time handling | Time must be stored in UTC and shown in the configured time zone; daylight-saving changes must not corrupt durations. | Must |
| NFR-DATA-01 | Data ownership | Data must be stored in open formats (SQLite file, JSON and CSV export) so it is never locked in. | Must |

### 11.2 Business rules

| ID | Rule |
| --- | --- |
| BR-01 | Only one timer runs at any time. |
| BR-02 | A task cannot be Ended without passing the closure gate; the gate requires at least one acceptance criterion. |
| BR-03 | If any acceptance criterion is unmet at closure, a lagging reason is mandatory. |
| BR-04 | A task has at most 3 links. |
| BR-05 | A task belongs to one project; a project has many tasks. |
| BR-06 | Time is tracked on tasks, optionally on a todo (phase) and with tags on the entry. |
| BR-07 | Task total time is the sum of its entries; it is never typed in by hand. |
| BR-08 | Starting a timer on an Open task makes it In progress. |
| BR-09 | An Ended task cannot receive a running timer until reopened; manual entries on an Ended task are allowed with a warning. |
| BR-10 | Closure records and history are never overwritten; new events add new records. |
| BR-11 | Reference materials and history stay after a task ends. |
| BR-12 | Hourly reminders fire only inside the configured working hours and days. |

Added rules:

- BR-13: Nothing is ever deleted; every remove action means archive, and the user can restore it.
- BR-14: Time tracking (timer and time entries) is changed only by the user in the interface.
- BR-15: The MCP assistant can only get and create; it cannot update, archive, close or delete anything.
- BR-16: Archiving a project hides it and its tasks from default views without changing the tasks; restoring the project brings them back.

## 12. User stories and acceptance criteria

Each story below is testable and traces to requirements. The wording is Given / When / Then.

### 12.1 User stories

| Story | As the user, I want to | Acceptance criteria | Requirements |
| --- | --- | --- | --- |
| US-01 | Start and stop a timer on a task | Given a task exists, when I click Start, then a timer runs in the top bar; when I click Stop, then an entry with start, end and duration is saved and the task total increases. | FR-TIME-01, 03, 05 |
| US-02 | Pick the todo (phase) and tags when I start | Given a task with todos, when I start the timer, then I can choose one todo and tags; the saved entry carries them. | FR-TIME-02, FR-PHASE-01 |
| US-03 | Have my running timer survive a refresh or restart | Given a timer is running, when I refresh the page or restart the container, then the timer still shows the true elapsed time. | FR-TIME-06, 10 |
| US-04 | See all entries and total time of a task | Given a task with entries, when I open it, then I see each entry and the total, plus totals per tag and per todo. | FR-TIME-12, 13 |
| US-05 | Add, edit and archive entries | Given an entry, when I change its times, then totals update at once; overlaps show a warning; end before start is rejected. | FR-TIME-14 to 16 |
| US-06 | Create a task with name, description and up to 3 links | Given the New task form, when I add a fourth link, then it is refused with a message; three links save. | FR-TASK-01 to 03 |
| US-07 | Group tasks into projects | Given a project with tasks, when I open it, then I see tasks by status, total time and time per tag. | FR-PRJ-01 to 05 |
| US-08 | See time per tag for a task | Given entries tagged coding and meeting, when I open the task, then I see time per tag as a table and chart. | FR-TAG-03, 04 |
| US-09 | Build a todo list and an acceptance-criteria checklist and edit both | Given a task, when I add, reorder or archive items in either list, then the change is saved and shown at once. | FR-TODO-01 to 04, FR-AC-01 to 03 |
| US-10 | Be unable to end a task without reviewing acceptance criteria | Given a task, when I click End task, then a popup lists all criteria; the task does not end until I confirm. | FR-GATE-01, 03, 08, BR-02 |
| US-11 | End a task with all criteria met | Given all criteria are ticked, when I confirm, then the task is Ended and the closure is stored as Fulfilled. | FR-GATE-04, 07 |
| US-12 | Explain why a task lagged when a criterion is not met | Given at least one criterion is unticked, when I try to confirm without a reason, then Confirm is disabled; after I write a reason it closes as Not fulfilled with the reason saved. | FR-GATE-05, 07, FR-LAG-01 |
| US-13 | Not close a task that has no acceptance criteria | Given a task without criteria, when I click End task, then I am asked to add criteria and the task stays open. | FR-AC-05, FR-GATE-02 |
| US-14 | Give each task a score and an estimate and compare with actual time | Given a task with an estimate of 3 hours and 4 hours tracked, when I open it, then I see a 1 hour over-run. | FR-TASK-06, 11, FR-PHASE-04 |
| US-15 | Keep reference materials on a task for later | Given a task, when I add a lesson-learned note, then it stays after the task ends and is found by search. | FR-REF-01 to 03, 05 |
| US-16 | Search tasks by keyword, project and timeline | Given many tasks, when I search a word and set project and date range, then only matching tasks show, with the words highlighted. | FR-SRCH-01 to 05 |
| US-17 | See what I worked on today or any past day | Given entries on a date, when I pick that date, then I see tasks, entries, totals and a copy-for-timesheet text. | FR-DAY-01 to 04 |
| US-18 | See phase timeline of a task | Given entries against todos, when I open the task timeline, then I see time per phase and when each was worked on. | FR-PHASE-01 to 03 |
| US-19 | Use a calendar with daily events | Given the calendar, when I create an event for tomorrow 10:00, then it shows in month, week and day views and on the Today page tomorrow. | FR-CAL-01, 02, 07 |
| US-20 | Add a reminder "remind me at" a time | Given a reminder for 15:30, when the time comes, then a popup and notification with sound appear with Done and Snooze. | FR-REM-01, 03 |
| US-21 | Get an hourly reminder about what I am doing | Given working hours 09:00 to 18:00, when the hour starts, then a popup shows the running task and elapsed time, or a No timer running warning. | FR-REM-05, 06, 08 |
| US-22 | Keep my data safe in Docker | Given the app runs in Docker, when I stop, remove and recreate the container, then all data is still there; a daily backup file exists. | DEP-03, 07, NFR-REL-01 |

### 12.2 Key workflows

**Daily use.** The user opens the Today page, starts a timer on the first task, picks a todo and tags, works, receives hourly reminders, switches tasks (the app stops one timer and starts the next), and at the end of the day opens the Day log to copy the list of tasks with durations into the office timesheet.

**Task life.** The user creates a project, creates a task with description, up to 3 links, score, estimate, todos, acceptance criteria and reference notes; starts work (the task becomes In progress); tracks time against todos; clicks End task; ticks the met criteria; writes a lagging reason if any is unmet; and the task becomes Ended with a closure record.

**Later lookup.** The user searches a keyword, narrows by project and date range, opens the task, and reads its reference materials, lagging reason and phase timeline.

## 13. Release plan, risks, open questions and traceability

### 13.1 Release phases

The build is split into four phases so a usable timer exists after the first one. Each phase ends when its exit test passes; dates are set when the build starts.

| Phase | Scope | Exit test |
| --- | --- | --- |
| 1. Foundation and timer | Docker setup with persistent volume and backup; projects, tasks, timer, time entries, tags, task totals, Today page, Day log | Stop and recreate the container with the timer running: data and timer survive; Day log copy text works |
| 2. Quality gate | Todos, acceptance criteria, closure popup with lagging reason, status rules, closure records, phase timeline, score and estimate | A task cannot be ended by any route without the gate (interface and API); lagging reason enforced |
| 3. Calendar and reminders | Calendar views, events, custom reminders, hourly reminder, notifications, missed reminders | Reminder fires within 30 seconds; missed ones show after reopening |
| 4. Knowledge and reports | Reference materials, global search with filters, reports, export and import, settings, polish | Search returns results under 1 second on test data; export then import restores everything |

Phase 5 (or in parallel from phase 2): MCP server. Scope: the `pdm-mcp` container with read tools first, then create tools, resources, prompts, access modes and audit page (section 14). Exit test: from an MCP client the user can search, get a day log and reports, and create a task with todos and criteria; the client has no way to start a timer, edit, close, archive or delete anything, and the API refuses such calls with the MCP token.

### 13.2 Risks

| ID | Risk | Effect | Mitigation |
| --- | --- | --- | --- |
| R1 | Docker Desktop not running after reboot | App not reachable | `restart: unless-stopped` and a note in the README to start Docker at login |
| R2 | Browser closed or laptop asleep at reminder time | Reminders missed | Missed tab and on-open catch-up (FR-REM-09); keep the app pinned in a tab or installed as a browser app window |
| R3 | Forgotten running timer | Wrong totals | Long-timer prompt and hourly reminder (FR-TIME-09, FR-REM-06) |
| R4 | Database file damaged or deleted | Loss of history | Daily backups, export, tested restore |
| R5 | Port clash with another local service | App will not start | Configurable port in `.env` |
| R6 | Feature growth beyond one-person use | Delay | MoSCoW priorities; Could items only after phase 4 |
| R7 | Closure gate feels slow when a task is small | User skips the tool | Keyboard-friendly popup, criteria templates (FR-AC-06) |

### 13.3 Open questions for the product owner

| ID | Question | Assumption used in this SRS |
| --- | --- | --- |
| Q1 | Should two timers be allowed to run at once? | No, one at a time (BR-01) |
| Q2 | What does the score mean and what scale (story points, 1 to 10, priority)? | A free number with a scale set in Settings (FR-TASK-06) |
| Q3 | What are the working hours and days for the hourly reminder? | 09:00 to 18:00, Monday to Friday |
| Q4 | Must the hourly reminder ring at exactly :00 or at another minute? | :00, configurable |
| Q5 | Which backend and database language do you prefer (Node.js, Python)? | Node.js with TypeScript and SQLite |
| Q6 | Should an Ended task allow adding manual time later? | Yes, with a warning (BR-09) |
| Q7 | Do you want acceptance-criteria templates? | Optional, Could priority |
| Q8 | Which format does your office timesheet need for the copy-paste text? | Task, duration, description, one per line |
| Q9 | Should a local password protect the app? | No in version 1 (NFR-SEC-05 is Could) |

### 13.4 Future ideas (out of scope for version 1)

Calendar sync with Google or Outlook, import from Clockify, Jira or GitHub links, task dependencies, Pomodoro mode, idle detection, mobile view, weekly email or PDF report, multi-user with login.

### 13.5 Requirement coverage

Every item in the original request maps to a section of this SRS.

| Your request | Where covered |
| --- | --- |
| Calendar and daily events | 7.1 |
| Hourly reminders and "remind me at" | 7.2, 7.3 |
| Dockerised, isolated, data saved | 3, DEP-01 to DEP-11, NFR-REL |
| Start and stop task time | 4.1 |
| Time entries and total per task | 4.2 |
| Task name, description, 3 links | FR-TASK-01 to 03 |
| See what I worked on any day | 8.3 |
| Projects with many tasks | 5.1 |
| Tags on entries and time per tag | 4.3 |
| Todo list and acceptance criteria checklist, both editable | 6.1, 6.2 |
| Statuses open, in progress, ended | 5.3 |
| Closing popup, no closure without criteria selection | 6.3, BR-02 |
| Reason for lagging when criteria unmet | FR-GATE-05, 6.4 |
| Score and estimation hours per task | FR-TASK-06, 11 |
| Reference materials per task | 8.1 |
| Search by keyword, project and timeline | 8.2 |
| Phase timeline by todo with time tracking | 4.4, FR-TODO-05 |

## 14. MCP server (second-brain interface)

PDM must ship with a Model Context Protocol (MCP) server so an AI assistant can act as the user's second brain: it searches past work, reads reports, and creates new notes and planning items. Time tracking (the timer and time entries) stays manual, and the assistant can only read it. The assistant can get and create; it can never update, archive, close or delete anything.

&#91;embedded content: MCP access path · 4 components\]

The assistant never reads the database directly: the MCP server calls the app's API, so every business rule (one timer, 3 links) is enforced in one place. The API also refuses update, archive, delete and time-tracking calls that carry the MCP token, so the limit holds even if the MCP server code changed.

### 14.1 Goals

- M1: Search and read everything (tasks, references, reports, day logs, time totals) from a chat, with no screen needed.
- M2: Let the assistant recall past work, lessons and references to help with new tasks (second brain).
- M3: Let the assistant create projects, tasks, tags, events, reminders and reference materials, so planning and note-taking need less typing.
- M4: Keep time tracking, editing, closing and archiving manual and in the user's hands.
- M5: Keep the same local-only privacy as the rest of PDM.

### 14.2 Deployment and access

| ID | Requirement | Priority |
| --- | --- | --- |
| MCP-01 | The MCP server must be built and started with the app by the same `docker compose up -d`, as a separate container `pdm-mcp`, so it can be stopped or updated without touching the app. | Must |
| MCP-02 | It must support the Streamable HTTP transport on 127.0.0.1 (default port 8765, set in `.env`), and should also offer a stdio mode (`docker compose run --rm -T pdm-mcp --stdio`) for clients that launch servers themselves. | Must |
| MCP-03 | It must talk to the app only through the app's REST API (never write to the SQLite file), so rules are shared. | Must |
| MCP-04 | Every request must carry a secret access token generated at first start and stored in the data volume; requests without it are refused. The token can be regenerated in Settings. | Must |
| MCP-05 | It must listen on the loopback address only and must not be reachable from the network. | Must |
| MCP-06 | It must follow the current MCP specification, expose a tool list with clear descriptions and JSON input schemas, and work with common MCP clients (for example Claude Desktop and Claude Code). | Must |
| MCP-07 | A README section must show how to add the server to a client, with copy-ready configuration. | Must |
| MCP-08 | It must report health and version, and return clear, human-readable error messages the assistant can act on. | Should |

### 14.3 Tools

The assistant may get (read, search, report) and create. It may not update, archive, delete or close anything, and it may not change time tracking. In the table below R means read only and C means create.

| Area | Assistant may | Assistant may not |
| --- | --- | --- |
| Timeline (timer and time entries) | Read the running timer, entries, day logs, totals and reports | Start or stop a timer; add, edit or archive entries |
| Projects | Create, get, list, summarise | Edit, archive, restore |
| Tasks | Create (with links, todos, criteria, score and estimate given at creation), get, list, search | Edit, change status, close, archive, add todos or criteria to an existing task |
| Todos and acceptance criteria | Read | Edit, tick, archive |
| Tags | Create, list | Rename, archive |
| Events and reminders | Create, get, list, read the agenda | Edit, snooze, complete, archive |
| Reference materials | Create on a task, get, list, search | Edit, archive |
| Reports and search | All read tools | Not applicable |
| Settings, backups, export, import | Nothing | Everything |

| Area | Tool | What it does | Type |
| --- | --- | --- | --- |
| Timeline | `get_running_timer` | Show the running task, todo, tags and elapsed time | R |
| Timeline | `list_time_entries` | List entries by task, date range, tag or todo | R |
| Timeline | `get_day_log` | Work log of any day with totals and timesheet-ready text | R |
| Tasks | `create_task` | Create a task with name, description, up to 3 links, project, score, estimate, due date, todos and acceptance criteria in one call | C |
| Tasks | `get_task`, `list_tasks` | Full task details with totals, per-tag and per-phase time, closure history; filtered lists | R |
| Projects | `create_project` | Create a project | C |
| Projects | `list_projects`, `get_project_summary` | Projects, status counts, time, estimate versus actual | R |
| Tags | `create_tag` | Create a tag | C |
| Tags | `list_tags` | List tags | R |
| Calendar | `create_event` | Create an event | C |
| Calendar | `list_events`, `get_agenda` | Events and the agenda of a day | R |
| Reminders | `create_reminder` | Create a reminder | C |
| Reminders | `list_reminders` | Upcoming, done and missed reminders | R |
| Knowledge | `add_reference` | Create a new reference material on a task | C |
| Knowledge | `list_references` | Read reference materials | R |
| Search | `search` | Global keyword search with project, status, tag and date filters (FR-SRCH-01 to 03) | R |
| Reports | `get_time_report`, `get_lagging_tasks`, `get_weekly_summary`, `get_estimate_history` | Time grouped by project, task, tag or phase; tasks closed with unmet criteria; weekly summary; estimate versus actual of similar tasks | R |

| ID | Requirement | Priority |
| --- | --- | --- |
| MCP-09 | The server must expose only the tools in the table above, with the read tools delivered first. | Must |
| MCP-10 | Tools that take a task must accept an id or a name; if a name matches more than one task, the tool must return the candidates and ask instead of guessing. | Must |
| MCP-11 | Tool results must be compact and structured (ids, names, durations in HH:MM and seconds) and support paging and a limit, so large histories do not overflow the assistant. | Must |
| MCP-12 | Each tool must return a plain-language summary line as well as structured data. | Should |
| MCP-13 | `create_task` must create the task, todos, acceptance criteria and links in one call and roll back everything if any part is invalid; the task starts as Open. | Must |
| MCP-27 | Create tools must check for a duplicate (same name in the same project or same day and time) and return the existing item instead of creating a second one. | Should |

### 14.4 Safety rules for AI callers

| ID | Requirement | Priority |
| --- | --- | --- |
| MCP-14 | The app's API must accept only read and create calls from the MCP token and must reject update, archive, delete, status-change and time-tracking calls from it, whatever the MCP server sends. | Must |
| MCP-15 | No MCP tool may update, change status, close, archive or delete anything. Closing a task stays behind the user's closure popup (section 6.3). | Must |
| MCP-16 | Time tracking is manual: no MCP tool may start or stop a timer or add, edit or archive a time entry. The timeline can only be read. | Must |
| MCP-17 | Settings must offer an access mode: Read only, Read and create (default), or Off, and per-tool switches. | Must |
| MCP-18 | Every item created through MCP must be marked as created by MCP, with the tool name and time, shown as a badge in lists and listed on an Audit page. | Must |
| MCP-19 | The server must rate-limit calls (default 60 per minute) and refuse oversized inputs. | Should |
| MCP-20 | Text sent by an assistant must be validated and escaped like any user input (NFR-SEC-02), and content read from tasks, notes or links must be treated as data, never as instructions to the assistant, which the tool descriptions must state. | Must |
| MCP-21 | The MCP server must make no outgoing network calls, apart from the loopback call to the app (NFR-PRIV-01). | Must |

### 14.5 Resources and prompts

Resources let the assistant load context; prompts are ready-made workflows the user can trigger.

| Kind | Name | Content or purpose | Priority |
| --- | --- | --- | --- |
| Resource | `pdm://today` | Today's agenda, running timer, hours so far, due reminders and tasks | Must |
| Resource | `pdm://day/{date}` | Work log of any day | Must |
| Resource | `pdm://task/{id}` | Full task: fields, todos, criteria, references, entries, closure history | Must |
| Resource | `pdm://project/{id}` | Project summary with tasks | Should |
| Resource | `pdm://references` | Library of reference materials, searchable | Should |
| Resource | `pdm://lagging` | Tasks closed as not fulfilled with reasons | Could |
| Prompt | `find_similar_work` | Search past tasks and reference materials related to a new task description to reuse lessons and estimates | Must |
| Prompt | `timesheet_summary` | Read a day's log and produce a timesheet-ready summary; the user still enters the time manually | Must |
| Prompt | `plan_my_day` | Read today's agenda, due tasks and reminders; propose an order of work (creates a reminder only if the user asks) | Should |
| Prompt | `end_of_day_review` | Show hours, tasks in progress and tomorrow's agenda | Should |
| Prompt | `weekly_review` | Summarise the week by project, tag and phase; list lagging tasks and lessons | Should |
| Prompt | `capture_lesson` | Turn the current conversation into a reference material created on the right task | Should |
| Prompt | `task_retrospective` | For a task, compare estimate with actual and review the lagging reason; propose reference notes and create them only if the user agrees | Should |

### 14.6 Second-brain requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| MCP-22 | The assistant must be able to find past work by meaning of keywords across tasks, descriptions, todos, criteria, lagging reasons, reference materials and entry notes, with date and project filters (uses FR-SRCH). | Must |
| MCP-23 | The assistant must be able to save a lesson, decision or link as a reference material on the right task straight from a conversation. | Must |
| MCP-24 | The server should return the estimate versus actual history of similar tasks so the assistant can suggest an estimate for a new task. | Should |
| MCP-25 | Search could later gain semantic (meaning-based) matching with a local model; this must stay optional and local (no external service). | Could |
| MCP-26 | A reference material could be marked as important so it is returned first by `find_similar_work`. | Could |

### 14.7 Data model additions

| Entity or field | Description |
| --- | --- |
| McpToken | Hash of the access token, created and last-used time, revoked flag |
| McpAuditLog | Tool name, arguments summary, result status, time |
| created\_by | New field (user or mcp) on Project, Task, Tag, CalendarEvent, Reminder and ReferenceMaterial |
| Setting | New keys: MCP access mode, per-tool switches, rate limit, MCP port |
| Not added | There is no MCP value for TimeEntry.source, and no pending-closure record, because the assistant cannot write time entries or close tasks |

### 14.8 Interface additions

- Settings gets an MCP section: access mode, per-tool switches, token show and regenerate, connection help and a test button (UI-14, Must).
- An Audit page lists everything the assistant created, with a filter; removing an item there means archiving it, done by the user (UI-15, Should).
- Items created by the assistant carry a small "created by assistant" badge in lists and on the item (UI-16, Should).

### 14.9 Acceptance tests

| Story | As the user, I want to | Acceptance criteria |
| --- | --- | --- |
| US-23 | Keep time tracking manual | Given an MCP client is connected, when I ask it to start a timer or add a time entry, then it has no such tool and says so; the timeline is unchanged. |
| US-24 | Ask what I did on any day | Given entries on a date, when I ask about that day, then `get_day_log` returns tasks, entries, totals and a timesheet-ready text. |
| US-25 | Be sure the assistant cannot change or close anything | Given a task exists, when the assistant tries to edit, close, archive or delete it, then no tool exists; a direct API call with the MCP token is refused. |
| US-26 | Ask about past work and lessons | Given past tasks and references, when I ask about a topic, then `find_similar_work` returns related tasks, lessons and their estimate versus actual. |
| US-27 | Let the assistant create planning items | Given I ask for a task with 3 todos and 2 criteria in a project, then it exists as Open, marked created by assistant; repeating the request does not create a duplicate. |
| US-28 | Restrict or switch off the assistant | Given mode Read only, when the assistant calls a create tool, then it is refused with a clear message; given Off, no call is accepted. |
| US-29 | Review what the assistant created | Given several MCP calls, when I open the Audit page, then each created item shows tool and time. |

### 14.10 Open questions

| ID | Question | Assumption used |
| --- | --- | --- |
| Q10 | Which MCP clients will you use (Claude Desktop, Claude Code, others)? | Any client that supports Streamable HTTP or stdio |
| Q11 | May the assistant add todos or acceptance criteria to an existing task? | No, because that updates a task; they can be given only when the task is created |
| Q12 | May the assistant create tags on the fly? | Yes, create only |
| Q13 | Do you want semantic (meaning-based) search for the second brain later? | Keyword search first; semantic search optional (MCP-25) |
| Q14 | Backup rotation removes old backup files (DEP-07). Is that acceptable, since it deletes no user data? | Yes; only backup copies rotate |
| Q15 | May you restore an archived item? | Yes, by the user only |
