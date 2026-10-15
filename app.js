(() => {
  "use strict";

  const STORAGE_KEY = "zach-zoey-halloween-yard-plan-v1";
  const AUTH_FALLBACK_PASSWORD = "ZachZoey";
  const AUTH_ENDPOINT = "/api/auth";
  const PLAN_ENDPOINT = "/api/plan";
  const REMOTE_POLL_MS = 10000;
  const FRONTAGE_FT = 95;
  const SCALE_PERCENT_PER_FT = 100 / FRONTAGE_FT;
  const COLOR_VARS = {
    coral: "#e86e48",
    yellow: "#efb943",
    teal: "#117f7b",
    plum: "#7c567c",
    blue: "#4779aa"
  };

  function normalizedPassword(value) {
    return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("en-US");
  }
  const PRESETS = {
    bounce: { name: "Bounce house", type: "Activity", widthFt: 20, depthFt: 20, color: "coral", reference: "", notes: "Check delivery clearance and outlet location." },
    game: { name: "Game station", type: "Activity", widthFt: 12, depthFt: 10, color: "yellow", reference: "", notes: "" },
    table: { name: "Food & drink table", type: "Food & drink", widthFt: 18, depthFt: 4, color: "teal", reference: "", notes: "Leave room behind the table for serving." },
    seating: { name: "Guest seating", type: "Seating", widthFt: 16, depthFt: 12, color: "plum", reference: "", notes: "" },
    blank: { name: "New setup", type: "Other", widthFt: 10, depthFt: 10, color: "blue", reference: "", notes: "" }
  };

  const els = {
    authGate: document.getElementById("authGate"),
    authForm: document.getElementById("authForm"),
    passwordInput: document.getElementById("passwordInput"),
    authError: document.getElementById("authError"),
    stage: document.getElementById("mapStage"),
    viewport: document.getElementById("mapViewport"),
    layer: document.getElementById("itemsLayer"),
    drawPreview: document.getElementById("drawPreview"),
    placementStatus: document.getElementById("placementStatus"),
    mapCount: document.getElementById("mapCount"),
    itemsList: document.getElementById("itemsList"),
    emptyList: document.getElementById("emptyList"),
    listTotal: document.getElementById("listTotal"),
    inspectorTitle: document.getElementById("inspectorTitle"),
    inspectorNumber: document.getElementById("inspectorNumber"),
    emptyInspector: document.getElementById("emptyInspector"),
    itemForm: document.getElementById("itemForm"),
    zoomRange: document.getElementById("zoomRange"),
    zoomValue: document.getElementById("zoomValue"),
    savedStatus: document.getElementById("savedStatus"),
    toast: document.getElementById("toast")
  };

  const starterItems = [
    { name: "Bounce house", type: "Activity", widthFt: 20, depthFt: 20, x: 18, y: 28, color: "coral", reference: "A · rental delivery", notes: "Confirm the gate path and outlet before delivery." },
    { name: "Pumpkin toss", type: "Activity", widthFt: 14, depthFt: 10, x: 54, y: 34, color: "yellow", reference: "B · game host", notes: "Buckets, beanbags, and score card." },
    { name: "Food & drink", type: "Food & drink", widthFt: 18, depthFt: 4, x: 39, y: 74, color: "teal", reference: "C · potluck table", notes: "Keep a clear route from the kitchen." }
  ];

  const state = {
    items: [],
    selectedId: null,
    tool: "select",
    zoom: 1,
    lockDimensions: true,
    saveTimer: null,
    remoteSaveTimer: null,
    remotePollTimer: null,
    remoteRevision: 0,
    remoteDirty: false,
    authenticated: false,
    authApiAvailable: false,
    remoteAvailable: false,
    drag: null,
    draw: null
  };

  function uid() {
    return `party-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeItem(raw, index) {
    const widthFt = clampNumber(raw.widthFt, 1, FRONTAGE_FT, 10);
    const depthFt = clampNumber(raw.depthFt, 1, FRONTAGE_FT, 10);
    const widthPct = widthFt * SCALE_PERCENT_PER_FT;
    const heightPct = depthFt * SCALE_PERCENT_PER_FT;
    return {
      id: raw.id || uid(),
      number: index + 1,
      name: String(raw.name || "New setup").slice(0, 40),
      type: String(raw.type || "Other"),
      widthFt,
      depthFt,
      x: clampNumber(raw.x, 0, 100 - widthPct, 50 - widthPct / 2),
      y: clampNumber(raw.y, 0, 100 - heightPct, 50 - heightPct / 2),
      rotation: clampNumber(raw.rotation, -180, 180, 0),
      color: COLOR_VARS[raw.color] ? raw.color : "blue",
      reference: String(raw.reference || "").slice(0, 50),
      notes: String(raw.notes || "").slice(0, 240)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function readSavedPlan() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.items)) return saved.items.map(normalizeItem);
    } catch (error) {
      console.warn("Could not load saved plan", error);
    }
    return starterItems.map(normalizeItem);
  }

  function loadState() {
    state.items = readSavedPlan();
    state.selectedId = state.items[0]?.id || null;
    renderAll();
  }

  function persist() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: state.items }));
        state.remoteDirty = state.authenticated && state.authApiAvailable;
        setSavedStatus(state.remoteDirty ? "Saving shared plan…" : "Saved locally", state.remoteDirty ? "cloud-upload" : "cloud");
        if (state.remoteDirty) queueRemoteSave();
        refreshIcons();
      } catch (error) {
        showToast("This browser blocked local saving.");
      }
    }, 180);
  }

  function setSavedStatus(label, icon = "cloud") {
    els.savedStatus.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>${label}`;
    refreshIcons();
  }

  function queueRemoteSave() {
    window.clearTimeout(state.remoteSaveTimer);
    if (!state.authenticated || !state.authApiAvailable) return;
    state.remoteSaveTimer = window.setTimeout(() => saveRemotePlan(), 450);
  }

  async function saveRemotePlan(isRetry = false) {
    if (!state.authenticated || !state.authApiAvailable || !state.remoteDirty) return;
    try {
      const response = await fetch(PLAN_ENDPOINT, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: state.remoteRevision, items: state.items })
      });
      if (response.status === 409) {
        const conflict = await response.json();
        const localItems = state.items;
        state.items = mergeItems(conflict.items || [], localItems).map(normalizeItem);
        state.remoteRevision = Number(conflict.revision || 0);
        state.selectedId = state.items[0]?.id || null;
        state.remoteDirty = true;
        renderAll();
        if (!isRetry) return saveRemotePlan(true);
        throw new Error("The shared plan changed again. Try saving once more.");
      }
      if (!response.ok) throw new Error(`Shared save failed (${response.status})`);
      const payload = await response.json();
      state.remoteRevision = Number(payload.revision || state.remoteRevision + 1);
      state.remoteDirty = false;
      setSavedStatus("Saved to shared plan", "cloud");
    } catch (error) {
      state.remoteAvailable = false;
      setSavedStatus("Local copy · sync paused", "cloud-off");
      showToast("The local copy is safe; shared sync needs attention.");
    }
  }

  function mergeItems(remoteItems, localItems) {
    const merged = new Map(remoteItems.map((item) => [item.id, item]));
    localItems.forEach((item) => merged.set(item.id, item));
    return Array.from(merged.values());
  }

  async function syncRemotePlan(options = {}) {
    if (!state.authenticated || !state.authApiAvailable || (state.remoteDirty && options.quiet)) return;
    try {
      const response = await fetch(PLAN_ENDPOINT, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Shared load failed (${response.status})`);
      const payload = await response.json();
      state.remoteAvailable = true;
      state.remoteRevision = Number(payload.revision || 0);
      if (Array.isArray(payload.items)) {
        const selectedId = state.selectedId;
        state.items = payload.items.map(normalizeItem);
        state.selectedId = state.items.some((item) => item.id === selectedId) ? selectedId : state.items[0]?.id || null;
        state.remoteDirty = false;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: state.items })); } catch (error) { /* local fallback is optional */ }
        renderAll();
        setSavedStatus("Saved to shared plan", "cloud");
      } else {
        state.remoteDirty = true;
        setSavedStatus("Preparing shared plan…", "cloud-upload");
        queueRemoteSave();
      }
    } catch (error) {
      state.remoteAvailable = false;
      setSavedStatus("Local copy · sync paused", "cloud-off");
      if (!options.quiet) showToast("Shared storage is not connected yet; this copy is local.");
    }
  }

  async function checkAuth() {
    try {
      const response = await fetch(AUTH_ENDPOINT, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 404) {
        state.authApiAvailable = false;
        return;
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        state.authApiAvailable = false;
        return;
      }
      state.authApiAvailable = true;
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.authenticated) unlockPlanner();
      }
    } catch (error) {
      state.authApiAvailable = false;
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const password = els.passwordInput.value.trim();
    const knownPassword = normalizedPassword(password) === normalizedPassword(AUTH_FALLBACK_PASSWORD);
    els.authError.hidden = true;
    try {
      const response = await fetch(AUTH_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        if (response.status === 401 && !knownPassword) throw new Error("That password is not right.");
        if (!knownPassword) throw new Error("The planner could not unlock.");
        throw new Error("Shared login is temporarily unavailable.");
      }
      state.authApiAvailable = true;
      unlockPlanner();
    } catch (error) {
      // Keep the board usable if an old deployment, blocked request, or a
      // temporary API outage prevents the shared session from being created.
      // The next successful shared login will restore collaboration.
      if (knownPassword) {
        state.authApiAvailable = false;
        unlockPlanner();
        showToast("Opened a local copy while shared login reconnects.");
        return;
      }
      els.authError.textContent = error.message;
      els.authError.hidden = false;
      els.passwordInput.select();
    }
  }

  function unlockPlanner() {
    state.authenticated = true;
    document.body.classList.add("is-authenticated");
    els.authGate.hidden = true;
    els.passwordInput.value = "";
    if (state.authApiAvailable) {
      syncRemotePlan();
      window.clearInterval(state.remotePollTimer);
      state.remotePollTimer = window.setInterval(() => syncRemotePlan({ quiet: true }), REMOTE_POLL_MS);
    } else {
      setSavedStatus("Saved locally", "cloud");
    }
    refreshIcons();
  }

  function refreshIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function getSelected() {
    return state.items.find((item) => item.id === state.selectedId) || null;
  }

  function renderAll() {
    state.items.forEach((item, index) => { item.number = index + 1; });
    renderMap();
    renderList();
    renderInspector();
    updateStatus();
    refreshIcons();
  }

  function renderMap() {
    els.layer.innerHTML = "";
    state.items.forEach((item) => {
      const widthPct = item.widthFt * SCALE_PERCENT_PER_FT;
      const heightPct = item.depthFt * SCALE_PERCENT_PER_FT;
      const box = document.createElement("div");
      box.className = "map-item";
      if (item.widthFt < 7 || item.depthFt < 6) box.classList.add("is-compact");
      if (item.widthFt < 4 || item.depthFt < 4) box.classList.add("is-tiny");
      if (item.id === state.selectedId) box.classList.add("is-selected");
      box.dataset.id = item.id;
      box.style.setProperty("--x", item.x);
      box.style.setProperty("--y", item.y);
      box.style.setProperty("--width", widthPct);
      box.style.setProperty("--height", heightPct);
      box.style.setProperty("--rotation", `${item.rotation}deg`);
      box.style.setProperty("--marker", COLOR_VARS[item.color]);
      box.title = `${item.number}. ${item.name} · ${formatFeet(item.widthFt)} × ${formatFeet(item.depthFt)} ft`;
      box.setAttribute("role", "button");
      box.setAttribute("aria-label", `${item.number}. ${item.name}, ${formatFeet(item.widthFt)} by ${formatFeet(item.depthFt)} feet`);
      box.innerHTML = `<span class="item-number">${item.number}</span><span class="item-name">${escapeHtml(item.name)}</span>`;
      els.layer.appendChild(box);
    });
  }

  function renderList() {
    els.itemsList.innerHTML = "";
    els.listTotal.textContent = state.items.length;
    els.mapCount.textContent = `${state.items.length} ${state.items.length === 1 ? "item" : "items"}`;
    els.emptyList.hidden = state.items.length > 0;
    state.items.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `item-card${item.id === state.selectedId ? " is-selected" : ""}`;
      card.dataset.id = item.id;
      card.style.setProperty("--marker", COLOR_VARS[item.color]);
      card.innerHTML = `
        <span class="item-card-number">${item.number}</span>
        <span class="item-card-body">
          <strong class="item-card-title">${escapeHtml(item.name)}</strong>
          <span class="item-card-meta"><span>${escapeHtml(item.type)}</span><span class="dot"></span><span>${formatFeet(item.widthFt)} × ${formatFeet(item.depthFt)} ft</span></span>
          ${item.reference ? `<span class="reference-line">${escapeHtml(item.reference)}</span>` : ""}
        </span>`;
      els.itemsList.appendChild(card);
    });
  }

  function renderInspector() {
    const item = getSelected();
    const hasItem = Boolean(item);
    els.emptyInspector.hidden = hasItem;
    els.itemForm.hidden = !hasItem;
    els.inspectorTitle.textContent = hasItem ? item.name : "Add an item";
    els.inspectorNumber.textContent = hasItem ? item.number : "—";
    els.inspectorNumber.classList.toggle("muted", !hasItem);
    if (!hasItem) return;
    els.itemForm.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      field.value = item[key] ?? "";
    });
    els.itemForm.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.classList.toggle("is-active", swatch.dataset.color === item.color);
    });
    const lock = document.getElementById("lockDimensions");
    lock.classList.toggle("is-locked", state.lockDimensions);
    lock.innerHTML = `<i data-lucide="${state.lockDimensions ? "lock" : "lock-open"}" aria-hidden="true"></i>`;
  }

  function updateStatus() {
    if (state.tool === "draw") {
      els.placementStatus.textContent = "Drag on the map to draw a footprint";
      els.stage.classList.add("is-drawing");
    } else if (getSelected()) {
      els.placementStatus.textContent = `Selected ${getSelected().number} · drag to position`;
      els.stage.classList.remove("is-drawing");
    } else {
      els.placementStatus.textContent = "Select an item to move it";
      els.stage.classList.remove("is-drawing");
    }
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("is-active", button.dataset.tool === tool));
    if (tool !== "draw") clearDrawPreview();
    updateStatus();
  }

  function addItem(presetKey = "blank", overrides = {}) {
    const preset = PRESETS[presetKey] || PRESETS.blank;
    const widthFt = overrides.widthFt || preset.widthFt;
    const depthFt = overrides.depthFt || preset.depthFt;
    const widthPct = widthFt * SCALE_PERCENT_PER_FT;
    const heightPct = depthFt * SCALE_PERCENT_PER_FT;
    const item = normalizeItem({
      ...preset,
      ...overrides,
      id: uid(),
      widthFt,
      depthFt,
      x: overrides.x ?? Math.max(0, 50 - widthPct / 2),
      y: overrides.y ?? Math.max(0, 50 - heightPct / 2)
    }, state.items.length);
    state.items.push(item);
    state.selectedId = item.id;
    setTool("select");
    persist();
    renderAll();
    showToast(`${item.name} added to the plan.`);
  }

  function selectItem(id) {
    if (!state.items.some((item) => item.id === id)) return;
    state.selectedId = id;
    setTool("select");
    renderAll();
  }

  function updateItem(key, value) {
    const item = getSelected();
    if (!item) return;
    if (key === "widthFt" || key === "depthFt") {
      const next = clampNumber(value, 1, FRONTAGE_FT, item[key]);
      if (key === "widthFt" && state.lockDimensions) {
        const ratio = item.depthFt / item.widthFt;
        item.widthFt = next;
        item.depthFt = clampNumber(next * ratio, 1, FRONTAGE_FT, item.depthFt);
      } else if (key === "depthFt" && state.lockDimensions) {
        const ratio = item.widthFt / item.depthFt;
        item.depthFt = next;
        item.widthFt = clampNumber(next * ratio, 1, FRONTAGE_FT, item.widthFt);
      } else {
        item[key] = next;
      }
      keepInBounds(item);
    } else if (key === "rotation") {
      item.rotation = Math.round(clampNumber(value, -180, 180, item.rotation) / 5) * 5;
    } else if (key === "name") {
      item.name = String(value).slice(0, 40);
    } else if (key === "reference") {
      item.reference = String(value).slice(0, 50);
    } else if (key === "notes") {
      item.notes = String(value).slice(0, 240);
    } else if (key === "type") {
      item.type = String(value);
    }
    persist();
    renderMap();
    renderList();
    if (key === "widthFt" || key === "depthFt") {
      els.itemForm.querySelector('[data-field="widthFt"]').value = item.widthFt;
      els.itemForm.querySelector('[data-field="depthFt"]').value = item.depthFt;
    }
    if (key === "rotation") els.itemForm.querySelector('[data-field="rotation"]').value = item.rotation;
    els.inspectorTitle.textContent = item.name;
    updateStatus();
  }

  function keepInBounds(item) {
    const widthPct = item.widthFt * SCALE_PERCENT_PER_FT;
    const heightPct = item.depthFt * SCALE_PERCENT_PER_FT;
    item.x = clampNumber(item.x, 0, Math.max(0, 100 - widthPct), 0);
    item.y = clampNumber(item.y, 0, Math.max(0, 100 - heightPct), 0);
  }

  function deleteSelected() {
    const item = getSelected();
    if (!item) return;
    const index = state.items.findIndex((candidate) => candidate.id === item.id);
    state.items.splice(index, 1);
    state.selectedId = state.items[index]?.id || state.items[index - 1]?.id || null;
    persist();
    renderAll();
    showToast(`${item.name} removed.`);
  }

  function duplicateSelected() {
    const item = getSelected();
    if (!item) return;
    addItem("blank", { ...item, name: `${item.name} copy`, x: item.x + 3, y: item.y + 3 });
  }

  function formatFeet(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function stagePoint(event) {
    const rect = els.stage.getBoundingClientRect();
    return {
      x: clampNumber((event.clientX - rect.left) / rect.width * 100, 0, 100, 0),
      y: clampNumber((event.clientY - rect.top) / rect.height * 100, 0, 100, 0)
    };
  }

  function onStagePointerDown(event) {
    const itemElement = event.target.closest?.(".map-item");
    if (state.tool === "draw" && !itemElement) {
      const point = stagePoint(event);
      state.draw = { start: point, current: point };
      els.stage.setPointerCapture?.(event.pointerId);
      drawPreview(point, point);
      event.preventDefault();
      return;
    }
    if (state.tool !== "select" || !itemElement) return;
    const item = state.items.find((candidate) => candidate.id === itemElement.dataset.id);
    if (!item) return;
    selectItem(item.id);
    const point = stagePoint(event);
    state.drag = { id: item.id, start: point, origin: { x: item.x, y: item.y } };
    els.stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onStagePointerMove(event) {
    if (state.draw) {
      state.draw.current = stagePoint(event);
      drawPreview(state.draw.start, state.draw.current);
      return;
    }
    if (!state.drag) return;
    const item = state.items.find((candidate) => candidate.id === state.drag.id);
    if (!item) return;
    const point = stagePoint(event);
    const widthPct = item.widthFt * SCALE_PERCENT_PER_FT;
    const heightPct = item.depthFt * SCALE_PERCENT_PER_FT;
    item.x = clampNumber(state.drag.origin.x + point.x - state.drag.start.x, 0, 100 - widthPct, item.x);
    item.y = clampNumber(state.drag.origin.y + point.y - state.drag.start.y, 0, 100 - heightPct, item.y);
    renderMap();
    updateStatus();
  }

  function onStagePointerUp(event) {
    if (state.draw) {
      const end = stagePoint(event);
      const left = Math.min(state.draw.start.x, end.x);
      const top = Math.min(state.draw.start.y, end.y);
      const widthPct = Math.abs(end.x - state.draw.start.x);
      const heightPct = Math.abs(end.y - state.draw.start.y);
      clearDrawPreview();
      state.draw = null;
      if (widthPct >= 2 && heightPct >= 2) {
        addItem("blank", {
          x: left,
          y: top,
          widthFt: roundHalf(widthPct / SCALE_PERCENT_PER_FT),
          depthFt: roundHalf(heightPct / SCALE_PERCENT_PER_FT)
        });
      } else {
        showToast("Drag a larger rectangle to place an item.");
      }
      return;
    }
    if (state.drag) {
      state.drag = null;
      persist();
      renderList();
      updateStatus();
    }
  }

  function drawPreview(start, end) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    els.drawPreview.hidden = false;
    els.drawPreview.style.left = `${left}%`;
    els.drawPreview.style.top = `${top}%`;
    els.drawPreview.style.width = `${Math.abs(end.x - start.x)}%`;
    els.drawPreview.style.height = `${Math.abs(end.y - start.y)}%`;
  }

  function clearDrawPreview() {
    state.draw = null;
    els.drawPreview.hidden = true;
    els.drawPreview.style.width = "0";
    els.drawPreview.style.height = "0";
  }

  function roundHalf(value) {
    return Math.max(1, Math.round(value * 2) / 2);
  }

  function handleKeydown(event) {
    const item = getSelected();
    if (!item || state.tool !== "select") return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key]) return;
    const [x, y] = directions[event.key];
    const step = event.shiftKey ? 5 * SCALE_PERCENT_PER_FT : SCALE_PERCENT_PER_FT;
    item.x += x * step;
    item.y += y * step;
    keepInBounds(item);
    renderMap();
    persist();
    event.preventDefault();
  }

  function setZoom(value) {
    state.zoom = Number(value);
    els.stage.style.width = `${state.zoom * 100}%`;
    els.zoomValue.value = `${Math.round(state.zoom * 100)}%`;
    els.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function exportPlan() {
    const payload = JSON.stringify({ app: "Zach & Zoey Halloween Party Planner", version: 1, exportedAt: new Date().toISOString(), items: state.items }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zach-zoey-halloween-plan.json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Plan backup downloaded.");
  }

  function importPlan(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!Array.isArray(payload.items)) throw new Error("Invalid plan");
        state.items = payload.items.map(normalizeItem);
        state.selectedId = state.items[0]?.id || null;
        persist();
        renderAll();
        showToast("Plan backup loaded.");
      } catch (error) {
        showToast("That file does not look like a plan backup.");
      }
    };
    reader.readAsText(file);
  }

  function resetPlan() {
    if (!window.confirm("Reset the plan to the starter layout?")) return;
    state.items = starterItems.map(normalizeItem);
    state.selectedId = state.items[0]?.id || null;
    persist();
    renderAll();
    showToast("Starter layout restored.");
  }

  function rotateSelected(amount) {
    const item = getSelected();
    if (!item) return;
    item.rotation = ((item.rotation + amount + 180) % 360) - 180;
    item.rotation = Math.round(item.rotation / 5) * 5;
    persist();
    renderMap();
    renderInspector();
    updateStatus();
  }

  let toastTimer;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  els.authForm.addEventListener("submit", submitPassword);
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => addItem(button.dataset.preset)));
  document.getElementById("addItemButton").addEventListener("click", () => addItem());
  document.getElementById("emptyAddButton").addEventListener("click", () => addItem());
  document.getElementById("deleteButton").addEventListener("click", deleteSelected);
  document.getElementById("duplicateButton").addEventListener("click", duplicateSelected);
  document.getElementById("resetButton").addEventListener("click", resetPlan);
  document.getElementById("exportButton").addEventListener("click", exportPlan);
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importInput").click());
  document.getElementById("importInput").addEventListener("change", (event) => importPlan(event.target.files[0]));
  document.getElementById("lockDimensions").addEventListener("click", () => {
    state.lockDimensions = !state.lockDimensions;
    renderInspector();
    refreshIcons();
  });
  document.getElementById("rotateLeft").addEventListener("click", () => rotateSelected(-15));
  document.getElementById("rotateRight").addEventListener("click", () => rotateSelected(15));
  els.zoomRange.addEventListener("input", (event) => setZoom(event.target.value));
  els.stage.addEventListener("pointerdown", onStagePointerDown);
  els.stage.addEventListener("pointermove", onStagePointerMove);
  els.stage.addEventListener("pointerup", onStagePointerUp);
  els.stage.addEventListener("pointercancel", onStagePointerUp);
  els.stage.addEventListener("keydown", handleKeydown);
  els.itemsList.addEventListener("click", (event) => {
    const card = event.target.closest(".item-card");
    if (card) selectItem(card.dataset.id);
  });
  els.itemForm.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) updateItem(field.dataset.field, field.value);
  });
  els.itemForm.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) updateItem(field.dataset.field, field.value);
  });
  els.itemForm.querySelector(".swatches").addEventListener("click", (event) => {
    const swatch = event.target.closest(".swatch");
    const item = getSelected();
    if (!swatch || !item) return;
    item.color = swatch.dataset.color;
    persist();
    renderAll();
  });

  setZoom(1);
  loadState();
  refreshIcons();
  checkAuth();
})();
