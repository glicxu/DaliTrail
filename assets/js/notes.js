// NOTES: quick note CRUD (create/read/update/delete)
// Self-contained page module that binds only when the Notes view exists in DOM.

const NOTES_KEY = "dalitrail:notes";
let notes = [];

// Late-resolved DOM refs
let notesView;
let noteInput;
let addNoteBtn;
let notesList;
let notesStatus;

// ----- persistence -----
function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    notes = Array.isArray(arr)
      ? arr.filter((n) => n && typeof n.id === "string" && typeof n.text === "string" && Number.isFinite(n.timestamp))
            .sort((a, b) => b.timestamp - a.timestamp)
      : [];
  } catch {
    notes = [];
  }
}

function persistNotes() {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
  catch (err) { if (notesStatus) notesStatus.textContent = `Unable to save notes: ${err.message}`; }
}

// ----- CRUD helpers -----
function createNote(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const n = { id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, text: trimmed, timestamp: Date.now() };
  notes = [n, ...notes];
  persistNotes();
  return n;
}

function updateNote(id, newText) {
  const trimmed = (newText || "").trim();
  const i = notes.findIndex((n) => n.id === id);
  if (i === -1) return false;
  if (!trimmed) { deleteNote(id); return true; }
  notes[i] = { ...notes[i], text: trimmed, timestamp: Date.now() };
  persistNotes();
  return true;
}

function deleteNote(id) {
  const before = notes.length;
  notes = notes.filter((n) => n.id !== id);
  if (notes.length !== before) persistNotes();
}

// ----- sharing -----
async function shareNote(n) {
  const body = `Note • ${new Date(n.timestamp).toLocaleString()}\n\n${n.text}`;
  if (navigator.share) {
    try { await navigator.share({ title: "DaliTrail Note", text: body }); notesStatus && (notesStatus.textContent = "Note shared."); return; }
    catch (e) { if (e.name === "AbortError") return; /* user cancelled */ }
  }
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(body); alert("Note copied to clipboard."); notesStatus && (notesStatus.textContent = "Note copied to clipboard."); return; }
    catch {}
  }
  // Fallback download as .txt
  const blob = new Blob([body], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dalitrail-note-${n.id}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  notesStatus && (notesStatus.textContent = "Note downloaded as text.");
}

// ----- render -----
function fmt(ts) { return new Date(ts).toLocaleString(); }

function renderNotes() {
  if (!notesList || !notesStatus) return;
  notesList.innerHTML = "";
  if (!notes.length) {
    notesStatus.textContent = "No notes yet. Write something and tap Add.";
    return;
  }
  notesStatus.textContent = `You have ${notes.length} note${notes.length === 1 ? "" : "s"}.`;

  notes.forEach((n) => {
    const li = document.createElement("li");
    li.className = "note-item";
    li.dataset.id = n.id;

    const card = document.createElement("div");
    card.className = "note-card";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span>${fmt(n.timestamp)}</span>`;

    const text = document.createElement("p");
    text.className = "note-text";
    text.textContent = n.text;

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `
      <button class="btn btn-outline" data-action="edit">Edit</button>
      <button class="btn btn-outline" data-action="share">Share</button>
      <button class="btn btn-danger"  data-action="delete">Delete</button>
    `;

    card.appendChild(meta);
    card.appendChild(text);
    card.appendChild(actions);
    li.appendChild(card);
    notesList.appendChild(li);
  });
}

// ----- events -----
function bindNoteEvents() {
  if (addNoteBtn) {
    addNoteBtn.addEventListener("click", () => {
      const txt = noteInput?.value || "";
      const n = createNote(txt);
      if (!n) { notesStatus && (notesStatus.textContent = "Type something before adding."); return; }
      if (noteInput) noteInput.value = "";
      renderNotes();
    });
  }

  if (notesList) {
    notesList.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("button[data-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const li = btn.closest(".note-item");
      const id = li?.dataset.id;
      const n = notes.find((x) => x.id === id);
      if (!id || !n) return;

      if (btn.dataset.action === "edit") {
        const next = window.prompt("Edit note:", n.text);
        if (next == null) return; // cancelled
        updateNote(id, next);
        renderNotes();
      }
      if (btn.dataset.action === "delete") {
        const ok = window.confirm("Delete this note? This cannot be undone.");
        if (!ok) return;
        deleteNote(id);
        renderNotes();
      }
      if (btn.dataset.action === "share") {
        await shareNote(n);
      }
    });
  }
}

// ----- SAFE INIT -----
function safeInitNotes() {
  console.log("[notes.js] Starting safeInitNotes...");
  try {
    notesView   = document.querySelector('.view.notes-view[data-view="notes"]');
    if (!notesView) return; // no-op if notes view not present

    noteInput   = document.getElementById("note-input");
    addNoteBtn  = document.getElementById("add-note-btn");
    notesList   = document.getElementById("notes-list");
    notesStatus = document.getElementById("notes-status");

    // light styles once
    if (!document.getElementById("notes-inline-style")) {
      const style = document.createElement("style");
      style.id = "notes-inline-style";
      style.textContent = `
        .notes-editor{display:grid;gap:.5rem;margin-bottom:.75rem}
        .notes-editor textarea{width:100%;min-height:6rem;padding:.6rem .75rem;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#050a16;color:#f5f5f5}
        .notes-editor textarea::placeholder{color:rgba(255,255,255,.6)}
        .notes-editor textarea:focus{outline:none;border-color:rgba(66,153,225,.7);box-shadow:0 0 0 2px rgba(66,153,225,.25)}
        .notes-list{display:grid;gap:.75rem;margin:.5rem 0}
        .note-card{border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:.6rem .75rem;background:#050a16;color:#f5f5f5}
        .note-card .meta{font-size:.85rem;color:rgba(245,245,245,.7);margin-bottom:.3rem}
        .note-card .actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem}
        @media(prefers-color-scheme:dark){
          .note-card{border-color:rgba(255,255,255,.18);background:#050a16;color:#f5f5f5}
          .notes-editor textarea{background:#050a16;color:#f5f5f5;border-color:rgba(255,255,255,.18)}
        }
        @media(prefers-color-scheme:light){
          .note-card{border-color:rgba(15,23,42,.12);background:rgba(255,255,255,.95);color:#0f172a}
          .note-card .meta{color:rgba(15,23,42,.6)}
          .notes-editor textarea{background:rgba(255,255,255,.95);color:#0f172a;border-color:rgba(15,23,42,.15)}
        }
      `;
      document.head.appendChild(style);
    }

    loadNotes();
    bindNoteEvents();
    renderNotes();
    console.log("[notes.js] safeInitNotes completed successfully.");
  } catch (err) {
    console.error("notes.js init failed:", err);
    console.log("[notes.js] safeInitNotes FAILED.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeInitNotes, { once: true });
} else {
  safeInitNotes();
}
