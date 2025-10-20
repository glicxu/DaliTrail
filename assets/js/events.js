// EVENTS: schedule upcoming outings with basic CRUD + calendar sharing.

const EVENTS_KEY = "dalitrail:events";

let events = [];
let editingEventId = null;

// DOM refs
let eventsView;
let eventForm;
let eventDatetimeInput;
let eventNoteInput;
let eventSaveBtn;
let eventCancelEditBtn;
let eventsList;
let eventsStatus;

// ----- persistence -----
const loadEvents = () => {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    events = Array.isArray(parsed)
      ? parsed
          .filter(
            (entry) =>
              entry &&
              typeof entry.id === "string" &&
              Number.isFinite(entry.occursAt) &&
              Number.isFinite(entry.createdAt) &&
              typeof entry.note === "string"
          )
          .sort((a, b) => a.occursAt - b.occursAt)
      : [];
  } catch {
    events = [];
  }
};

const persistEvents = () => {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch (error) {
    if (eventsStatus) eventsStatus.textContent = `Unable to save events: ${error.message}`;
  }
};

// ----- helpers -----
const createEvent = ({ occursAt, note }) => {
  const trimmedNote = (note || "").trim();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    occursAt,
    note: trimmedNote,
    createdAt: Date.now(),
  };
  events = [...events, entry].sort((a, b) => a.occursAt - b.occursAt);
  persistEvents();
  return entry;
};

const updateEvent = (id, { occursAt, note }) => {
  const i = events.findIndex((entry) => entry.id === id);
  if (i === -1) return false;
  events[i] = {
    ...events[i],
    occursAt,
    note: (note || "").trim(),
    updatedAt: Date.now(),
  };
  events = [...events].sort((a, b) => a.occursAt - b.occursAt);
  persistEvents();
  return true;
};

const deleteEvent = (id) => {
  const before = events.length;
  events = events.filter((entry) => entry.id !== id);
  if (events.length !== before) {
    persistEvents();
    return true;
  }
  return false;
};

const formatInputDateTime = (timestamp) => {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const formatEventDate = (timestamp) =>
  new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const describeTiming = (timestamp) => {
  const now = Date.now();
  const diffMs = timestamp - now;
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  let magnitude = "";
  if (absMinutes >= 60 * 24) {
    const days = Math.round(absMinutes / (60 * 24));
    magnitude = `${days} day${days === 1 ? "" : "s"}`;
  } else if (absMinutes >= 60) {
    const hours = Math.round(absMinutes / 60);
    magnitude = `${hours} hour${hours === 1 ? "" : "s"}`;
  } else {
    magnitude = `${absMinutes} minute${absMinutes === 1 ? "" : "s"}`;
  }
  if (diffMinutes > 0) return `Starts in ${magnitude}`;
  if (diffMinutes < 0) return `${magnitude} ago`;
  return "Happening now";
};

const resetForm = () => {
  editingEventId = null;
  if (eventForm) eventForm.reset();
  if (eventDatetimeInput) eventDatetimeInput.value = "";
  if (eventNoteInput) eventNoteInput.value = "";
  if (eventSaveBtn) eventSaveBtn.textContent = "Add Event";
  if (eventCancelEditBtn) eventCancelEditBtn.hidden = true;
};

const setEditing = (entry) => {
  editingEventId = entry.id;
  if (eventDatetimeInput) eventDatetimeInput.value = formatInputDateTime(entry.occursAt);
  if (eventNoteInput) eventNoteInput.value = entry.note || "";
  if (eventSaveBtn) eventSaveBtn.textContent = "Save Changes";
  if (eventCancelEditBtn) eventCancelEditBtn.hidden = false;
  if (eventsStatus) eventsStatus.textContent = "Editing event…";
  eventDatetimeInput?.focus();
};

const escapeIcsText = (value) =>
  (value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const formatIcsDate = (timestamp) => {
  const date = new Date(timestamp);
  const iso = date.toISOString().replace(/[-:]/g, "");
  return iso.slice(0, 15) + "Z";
};

const makeIcsContent = (entry) => {
  const start = entry.occursAt;
  const end = start + 60 * 60 * 1000;
  const summary = entry.note ? entry.note.split(/\r?\n/)[0].trim() : "DaliTrail Event";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DaliTrail//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${entry.id}@dalitrail`,
    `DTSTAMP:${formatIcsDate(Date.now())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(summary || "DaliTrail Event")}`,
    `DESCRIPTION:${escapeIcsText(entry.note || "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
};

const shareEvent = async (entry) => {
  const summary = entry.note ? entry.note.split(/\r?\n/)[0].trim() : "DaliTrail Event";
  const friendlyDate = formatEventDate(entry.occursAt);
  const shareText = `${summary || "DaliTrail Event"}\n${friendlyDate}\n\nSent from DaliTrail.`;

  const icsText = makeIcsContent(entry);
  const fileName = `dalitrail-event-${entry.id}.ics`;

  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([icsText], fileName, { type: "text/calendar" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: summary || "DaliTrail Event", text: shareText });
        eventsStatus && (eventsStatus.textContent = "Event shared to calendar.");
        return;
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn("Share with file failed, falling back.", error);
      } else {
        return;
      }
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: summary || "DaliTrail Event", text: `${shareText}\n\n${icsText}` });
      eventsStatus && (eventsStatus.textContent = "Event shared.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  const blob = new Blob([icsText], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  eventsStatus && (eventsStatus.textContent = "ICS file downloaded for calendar import.");
};

const renderEvents = () => {
  if (!eventsList || !eventsStatus) return;
  eventsList.innerHTML = "";
  if (!events.length) {
    eventsStatus.textContent = "No events scheduled yet.";
    return;
  }

  const frag = document.createDocumentFragment();
  events.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "event-item";
    li.dataset.id = entry.id;

    const card = document.createElement("div");
    card.className = "event-card";

    const meta = document.createElement("div");
    meta.className = "event-meta";
    const timeLabel = document.createElement("span");
    timeLabel.textContent = formatEventDate(entry.occursAt);
    meta.appendChild(timeLabel);

    const timing = document.createElement("span");
    timing.textContent = describeTiming(entry.occursAt);
    meta.appendChild(timing);

    card.appendChild(meta);

    const noteBlock = document.createElement("p");
    noteBlock.className = "event-note";
    noteBlock.textContent = entry.note || "No additional notes.";
    card.appendChild(noteBlock);

    const actions = document.createElement("div");
    actions.className = "event-actions";
    actions.innerHTML = `
      <button class="btn btn-outline" type="button" data-action="edit">Edit</button>
      <button class="btn btn-outline" type="button" data-action="share">Share to Calendar</button>
      <button class="btn btn-danger" type="button" data-action="delete">Delete</button>
    `;
    card.appendChild(actions);

    li.appendChild(card);
    frag.appendChild(li);
  });

  eventsList.appendChild(frag);
  eventsStatus.textContent = `You have ${events.length} event${events.length === 1 ? "" : "s"} scheduled.`;
};

// ----- events -----
const handleSubmit = (event) => {
  event.preventDefault();
  if (!eventDatetimeInput || !eventSaveBtn) return;

  const datetimeValue = eventDatetimeInput.value;
  if (!datetimeValue) {
    eventsStatus && (eventsStatus.textContent = "Pick a date and time before saving.");
    eventDatetimeInput.focus();
    return;
  }
  const occursAt = Date.parse(datetimeValue);
  if (!Number.isFinite(occursAt)) {
    eventsStatus && (eventsStatus.textContent = "Unable to read the selected date/time.");
    eventDatetimeInput.focus();
    return;
  }

  const noteValue = eventNoteInput?.value || "";

  if (editingEventId) {
    updateEvent(editingEventId, { occursAt, note: noteValue });
    eventsStatus && (eventsStatus.textContent = "Event updated.");
  } else {
    createEvent({ occursAt, note: noteValue });
    eventsStatus && (eventsStatus.textContent = "Event added.");
  }
  resetForm();
  renderEvents();
};

const handleListClick = async (event) => {
  const target = event.target?.closest?.("button[data-action]");
  if (!(target instanceof HTMLButtonElement)) return;
  const item = target.closest(".event-item");
  const id = item?.dataset.id;
  if (!id) return;
  const entry = events.find((evt) => evt.id === id);
  if (!entry) return;

  if (target.dataset.action === "edit") {
    setEditing(entry);
    return;
  }

  if (target.dataset.action === "delete") {
    const confirmed = window.confirm("Delete this event? This cannot be undone.");
    if (!confirmed) return;
    deleteEvent(id);
    if (editingEventId === id) resetForm();
    renderEvents();
    eventsStatus && (eventsStatus.textContent = "Event deleted.");
    return;
  }

  if (target.dataset.action === "share") {
    try {
      await shareEvent(entry);
    } catch (error) {
      console.error("Event share failed:", error);
      eventsStatus && (eventsStatus.textContent = `Unable to share event: ${error?.message || error}`);
    }
  }
};

// ----- SAFE INIT -----
const safeInitEvents = () => {
  try {
    eventsView = document.querySelector('.event-view[data-view="events"]');
    if (!eventsView) return;

    eventForm = document.getElementById("event-form");
    eventDatetimeInput = document.getElementById("event-datetime");
    eventNoteInput = document.getElementById("event-note");
    eventSaveBtn = document.getElementById("event-save-btn");
    eventCancelEditBtn = document.getElementById("event-cancel-edit-btn");
    eventsList = document.getElementById("events-list");
    eventsStatus = document.getElementById("events-status");

    loadEvents();
    renderEvents();

    eventForm?.addEventListener("submit", handleSubmit);
    eventsList?.addEventListener("click", handleListClick);
    eventCancelEditBtn?.addEventListener("click", () => {
      resetForm();
      eventsStatus && (eventsStatus.textContent = "Edit cancelled.");
    });
  } catch (error) {
    console.error("events.js init failed:", error);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeInitEvents, { once: true });
} else {
  safeInitEvents();
}
