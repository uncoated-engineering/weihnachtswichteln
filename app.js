(() => {
  "use strict";
  const CFG = window.WICHTEL_CONFIG;
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const BASE = location.origin + location.pathname;
  const SESSION_KEY = "wichteln.session";

  // ---------- Helfer ----------
  async function rpc(fn, args = {}) {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: `Bearer ${CFG.supabaseKey}` },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error((data && data.message) || "Das hat nicht geklappt. Bitte nochmal versuchen.");
    return data;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const render = (html) => { app.innerHTML = html; };
  const $ = (sel) => app.querySelector(sel);
  const $$ = (sel) => [...app.querySelectorAll(sel)];

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }
  async function share(text, url) {
    const full = url ? `${text}\n${url}` : text;
    if (navigator.share) {
      try { await navigator.share(url ? { text, url } : { text }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(full); toast("Kopiert – jetzt z.B. in Signal einfügen"); }
    catch { prompt("Zum Kopieren:", full); }
  }

  const session = {
    get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch {} },
    clear() { try { localStorage.removeItem(SESSION_KEY); } catch {} },
  };

  function head(g) {
    const facts = [];
    if (g.event_date) facts.push(`<span>🎄 ${esc(g.event_date)}</span>`);
    if (g.budget) facts.push(`<span>Budget: ${esc(g.budget)}</span>`);
    return `
      <header class="head">
        <p class="year">Wichteln ${esc(CFG.year)}</p>
        <h1>${esc(g.name)}</h1>
        ${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}
      </header>`;
  }

  function failView(msg) {
    render(`<div class="sheet center"><p>${esc(msg)}</p><button class="btn" type="button" id="retry">Nochmal laden</button></div>`);
    $("#retry").addEventListener("click", () => route());
  }

  // ---------- Start: Wer bist du? ----------
  async function startView() {
    const s = session.get();
    if (s && s.token) return meView(s.token);

    let g;
    try { g = await rpc("family_get", { p_join_code: CFG.familyCode }); }
    catch (err) { return failView(err.message); }

    const people = g.participants;
    render(`
      ${head(g)}
      ${g.message ? `<div class="sheet"><p class="note">${esc(g.message)}</p></div>` : ""}
      <div class="sheet">
        <h2>Wer bist du?</h2>
        ${people.length
          ? `<p class="quiet">Tippe auf deinen Namen.</p>
             <div class="tags">${people.map((p) => `<button class="tag-btn" type="button" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>`
          : `<p class="quiet">Noch hat sich niemand eingetragen. Fang du an!</p>`}
        ${g.drawn
          ? `<p class="quiet small">Die Namen sind schon gezogen. Wenn du fehlst, sag dem Organisator Bescheid.</p>`
          : `<button class="btn ${people.length ? "plain" : ""} block" type="button" id="new">Ich bin neu hier</button>`}
      </div>
    `);

    $$(".tag-btn").forEach((b) => b.addEventListener("click", () => {
      pinView(g, people.find((p) => p.id === b.dataset.id));
    }));
    $("#new")?.addEventListener("click", () => newView(g));
  }

  // ---------- PIN eingeben ----------
  function pinView(g, person) {
    const first = !person.has_pin;
    render(`
      ${head(g)}
      <div class="sheet">
        <h2>Hallo ${esc(person.name)}!</h2>
        <form id="pinform">
          <p class="quiet">${first
            ? "Denk dir eine PIN aus 4 Ziffern aus. Damit kommst du jederzeit wieder rein – auch von einem anderen Gerät."
            : "Gib deine PIN ein."}</p>
          <div class="field">
            <label for="pin" class="center">${first ? "Neue PIN" : "PIN"}</label>
            <input id="pin" class="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required>
          </div>
          <p id="err" class="error center" hidden></p>
          <button class="btn block" type="submit">${first ? "PIN festlegen" : "Weiter"}</button>
        </form>
        <p class="center" style="margin-top:14px"><button class="linkish" type="button" id="back">Das bin ich nicht</button></p>
        ${first ? "" : `<p class="quiet small center">PIN vergessen? Sag dem Organisator Bescheid, er setzt sie zurück.</p>`}
      </div>
    `);
    const input = $("#pin");
    input.focus();
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 4);
      if (input.value.length === 4) $("#pinform").requestSubmit();
    });
    $("#back").addEventListener("click", () => startView());
    $("#pinform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#pinform button[type=submit]");
      if (btn.disabled) return;
      busy(btn, true, "Einen Moment…");
      try {
        const r = await rpc("family_login", { p_join_code: CFG.familyCode, p_participant_id: person.id, p_pin: input.value });
        session.set({ token: r.participant_token, name: person.name });
        if (r.pin_set) toast("PIN gespeichert – gut merken!");
        meView(r.participant_token);
      } catch (err) {
        const el = $("#err"); el.textContent = err.message; el.hidden = false;
        input.value = ""; input.focus();
        busy(btn, false);
      }
    });
  }

  // ---------- Neu dabei ----------
  function newView(g) {
    render(`
      ${head(g)}
      <div class="sheet">
        <h2>Schön, dass du dabei bist</h2>
        <form id="newform">
          <div class="field">
            <label for="name">Dein Name</label>
            <input id="name" maxlength="60" required autocomplete="given-name" placeholder="So, wie die Familie dich nennt">
          </div>
          <div class="field">
            <label for="pin">Denk dir eine PIN aus 4 Ziffern aus</label>
            <input id="pin" class="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required>
            <p class="quiet small center" style="margin-top:6px">Damit kommst du später wieder rein.</p>
          </div>
          <p id="err" class="error" hidden></p>
          <button class="btn block" type="submit">Eintragen</button>
        </form>
        <p class="center" style="margin-top:14px"><button class="linkish" type="button" id="back">Zurück</button></p>
      </div>
    `);
    $("#name").focus();
    const pin = $("#pin");
    pin.addEventListener("input", () => { pin.value = pin.value.replace(/\D/g, "").slice(0, 4); });
    $("#back").addEventListener("click", () => startView());
    $("#newform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter || $("#newform button[type=submit]");
      const name = $("#name").value.trim();
      busy(btn, true, "Wird eingetragen…");
      try {
        const r = await rpc("family_join", { p_join_code: CFG.familyCode, p_name: name, p_pin: pin.value });
        session.set({ token: r.participant_token, name });
        toast("Du bist eingetragen!");
        meView(r.participant_token);
      } catch (err) {
        const el = $("#err"); el.textContent = err.message; el.hidden = false;
        busy(btn, false);
      }
    });
  }

  // ---------- Meine Seite ----------
  async function meView(token) {
    let d;
    try { d = await rpc("get_me", { p_token: token }); }
    catch (err) {
      if (/Ungültig/.test(err.message)) { session.clear(); return startView(); }
      return failView(err.message);
    }
    const g = d.group;
    const opened = sessionStorage.getItem("opened." + token) === "1";

    render(`
      ${head(g)}
      <div class="sheet">
        <div class="hello">
          <h2>Hallo ${esc(d.name)}</h2>
          <button class="linkish small" type="button" id="logout">Nicht du?</button>
        </div>
        ${d.receiver
          ? `<div class="reveal" id="reveal">${opened ? tagHtml(d.receiver) : `
              <p>Die Namen sind gezogen.</p>
              <button class="gift" type="button" id="open" aria-label="Geschenk öffnen">
                <span class="box"></span><span class="lid"></span><span class="ribbon-v"></span><span class="bow"></span>
              </button>
              <p class="quiet">Tippe auf das Geschenk und schau, wen du beschenkst.<br>Nicht verraten!</p>`}
            </div>`
          : `<p>Noch wird nicht gelost. Sobald alle eingetragen sind, werden die Namen gezogen – schau dann einfach wieder hier vorbei.</p>
             <p class="quiet small" style="margin-top:14px">Schon dabei:</p>
             <div class="names">${d.participants.map((p) => `<span>${esc(p.name)}</span>`).join("")}</div>`}
      </div>

      ${g.message ? `<div class="sheet"><p class="note">${esc(g.message)}</p></div>` : ""}

      <div class="sheet">
        <h2>Mein Wunschzettel</h2>
        <p class="quiet">Wer dich zieht, kann das hier lesen.</p>
        <form id="wish">
          <textarea id="wishtext" maxlength="2000" aria-label="Mein Wunschzettel" placeholder="Was würde dich freuen? Größen, Lieblingsfarben, was du auf keinen Fall brauchst…">${esc(d.wishlist)}</textarea>
          <button class="btn fir" type="submit" style="margin-top:12px">Wunschzettel speichern</button>
        </form>
      </div>
    `);

    $("#logout").addEventListener("click", () => { session.clear(); startView(); });
    $("#open")?.addEventListener("click", () => {
      sessionStorage.setItem("opened." + token, "1");
      $("#reveal").innerHTML = tagHtml(d.receiver);
    });
    $("#wish").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter || $("#wish button");
      busy(btn, true, "Wird gespeichert…");
      try { await rpc("update_wishlist", { p_token: token, p_wishlist: $("#wishtext").value }); toast("Wunschzettel gespeichert"); }
      catch (err) { toast(err.message); }
      busy(btn, false);
    });
  }

  function tagHtml(r) {
    return `
      <div class="for-tag"><span class="for">Für:</span><span class="who">${esc(r.name)}</span></div>
      ${r.wishlist
        ? `<p class="quiet" style="margin-bottom:6px;text-align:left">Wunschzettel von ${esc(r.name)}:</p><div class="wish">${esc(r.wishlist)}</div>`
        : `<p class="quiet">${esc(r.name)} hat noch keinen Wunschzettel geschrieben. Schau später nochmal vorbei.</p>`}`;
  }

  // ---------- Organisator ----------
  async function adminView(token) {
    let d;
    try { d = await rpc("admin_get", { p_admin_token: token }); }
    catch (err) { return failView(err.message); }

    const byId = Object.fromEntries(d.participants.map((p) => [p.id, p]));
    const seen = d.participants.filter((p) => p.seen).length;
    const inviteText = `🎁 Wichteln ${CFG.year}! Trag dich hier ein und schreib deinen Wunschzettel:`;

    render(`
      ${head(d)}
      <div class="sheet">
        <h2>Organisieren</h2>
        <p class="quiet">Diese Seite ist nur für dich. Behalte den Link für dich.</p>
        <p>Schick allen diesen Link:</p>
        <div class="row" style="margin-bottom:10px">
          <input readonly value="${esc(BASE)}" aria-label="Link für die Familie">
        </div>
        <button class="btn fir block" type="button" id="invite">Link teilen</button>
      </div>

      <div class="sheet">
        <h2>Dabei (${d.participants.length})</h2>
        ${d.drawn ? `<p class="quiet">${seen} von ${d.participants.length} haben schon nachgeschaut.</p>` : ""}
        <ul class="list">
          ${d.participants.map((p) => `
            <li>
              <span class="who">${esc(p.name)}
                <span class="state">${[
                  p.locked ? "gesperrt – zu oft falsche PIN" : (p.has_pin ? "PIN gesetzt" : "noch keine PIN"),
                  p.has_wishlist ? "Wunschzettel ✓" : "",
                  d.drawn ? (p.seen ? "hat nachgeschaut" : "noch nicht nachgeschaut") : "",
                ].filter(Boolean).join(", ")}</span>
              </span>
              <span class="acts">
                ${p.has_pin || p.locked ? `<button class="btn plain small" type="button" data-resetpin="${esc(p.id)}" data-name="${esc(p.name)}">PIN zurücksetzen</button>` : ""}
                ${!d.drawn ? `<button class="btn plain small" type="button" data-remove="${esc(p.id)}" data-name="${esc(p.name)}" aria-label="${esc(p.name)} entfernen">Entfernen</button>` : ""}
              </span>
            </li>`).join("")}
        </ul>
        ${!d.drawn ? `
          <form id="add" class="row">
            <input id="addname" maxlength="60" placeholder="Jemanden eintragen, z.B. Opa" aria-label="Name">
            <button class="btn plain" type="submit" style="flex:0 0 auto">Eintragen</button>
          </form>
          <p class="quiet small" style="margin-top:8px">Wer von dir eingetragen wird, legt beim ersten Antippen seines Namens selbst eine PIN fest.</p>` : ""}
      </div>

      ${!d.drawn ? `
      <div class="sheet">
        <details ${d.exclusions.length ? "open" : ""}>
          <summary>Wer soll sich nicht gegenseitig ziehen?</summary>
          ${d.exclusions.map((x) => `
            <div class="hello" style="margin-bottom:6px">
              <span>${esc(byId[x.a]?.name)} und ${esc(byId[x.b]?.name)}</span>
              <button class="btn plain small" type="button" data-unexcl="${esc(x.a)}|${esc(x.b)}">Aufheben</button>
            </div>`).join("")}
          ${d.participants.length >= 2 ? `
          <form id="excl" style="margin-top:10px">
            <div class="row stack">
              <select id="ea" aria-label="Person 1">${d.participants.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
              <select id="eb" aria-label="Person 2">${d.participants.map((p, i) => `<option value="${esc(p.id)}" ${i === 1 ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
            </div>
            <button class="btn plain block" type="submit" style="margin-top:10px">Diese zwei nicht</button>
          </form>` : `<p class="quiet">Dafür braucht es mindestens zwei Leute.</p>`}
        </details>
      </div>

      <div class="sheet">
        <h2>Namen ziehen</h2>
        <p class="quiet">Wenn alle dabei sind. Niemand sieht die ganze Liste – auch du nicht. Danach kann sich niemand mehr neu eintragen.</p>
        <p id="drawerr" class="error" hidden></p>
        <button class="btn block" type="button" id="draw" ${d.participants.length < 3 ? "disabled" : ""}>Jetzt auslosen</button>
        ${d.participants.length < 3 ? `<p class="quiet small center" style="margin-top:8px">Mindestens 3 Leute nötig.</p>` : ""}
      </div>` : `
      <div class="sheet">
        <h2>Ausgelost</h2>
        <p>Sag allen Bescheid, dass sie nachschauen können.</p>
        <button class="btn fir block" type="button" id="tellall">Nachricht an alle teilen</button>
        <details style="margin-top:18px">
          <summary class="quiet">Neu auslosen</summary>
          <p class="quiet">Löscht die jetzige Zuordnung, z.B. wenn noch jemand dazukommt. Danach musst du neu auslosen und alle müssen nochmal nachschauen.</p>
          <button class="btn plain" type="button" id="reset">Auslosung zurücksetzen</button>
        </details>
      </div>`}

      <div class="sheet">
        <details>
          <summary>Texte bearbeiten</summary>
          <form id="edit">
            <div class="field"><label for="ename">Überschrift</label><input id="ename" maxlength="80" value="${esc(d.name)}" required></div>
            <div class="row stack">
              <div class="field"><label for="edate">Wann</label><input id="edate" maxlength="40" value="${esc(d.event_date)}" placeholder="z.B. 24. Dezember"></div>
              <div class="field"><label for="ebudget">Budget</label><input id="ebudget" maxlength="40" value="${esc(d.budget)}" placeholder="z.B. 25 €"></div>
            </div>
            <div class="field"><label for="emsg">Nachricht an alle</label><textarea id="emsg" maxlength="500">${esc(d.message)}</textarea></div>
            <button class="btn fir" type="submit">Speichern</button>
          </form>
        </details>
      </div>
    `);

    const reload = () => adminView(token);
    const act = async (btn, fn, ok) => {
      busy(btn, true);
      try { await fn(); if (ok) toast(ok); await reload(); }
      catch (err) { toast(err.message); busy(btn, false); }
    };

    $("#invite").addEventListener("click", () => share(inviteText, BASE));
    $("#tellall")?.addEventListener("click", () => share(`🎁 Die Wichtel-Namen sind gezogen! Schaut hier nach, wen ihr beschenkt:`, BASE));
    $$("[data-resetpin]").forEach((b) => b.addEventListener("click", () =>
      act(b, () => rpc("admin_reset_pin", { p_admin_token: token, p_participant_id: b.dataset.resetpin }),
        `PIN von ${b.dataset.name} zurückgesetzt – beim nächsten Mal neue PIN wählen`)));
    $$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm(`${b.dataset.name} wirklich entfernen?`)) return;
      act(b, () => rpc("admin_remove_participant", { p_admin_token: token, p_participant_id: b.dataset.remove }), `${b.dataset.name} entfernt`);
    }));
    $$("[data-unexcl]").forEach((b) => b.addEventListener("click", () => {
      const [a, bb] = b.dataset.unexcl.split("|");
      act(b, () => rpc("admin_set_exclusion", { p_admin_token: token, p_a: a, p_b: bb, p_excluded: false }));
    }));
    $("#add")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#addname").value.trim();
      if (!name) return;
      act(e.submitter, () => rpc("admin_add_participant", { p_admin_token: token, p_name: name }), `${name} eingetragen`);
    });
    $("#excl")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = $("#ea").value, b = $("#eb").value;
      if (a === b) return toast("Bitte zwei verschiedene Personen wählen");
      act(e.submitter, () => rpc("admin_set_exclusion", { p_admin_token: token, p_a: a, p_b: b, p_excluded: true }), "Gespeichert");
    });
    $("#draw")?.addEventListener("click", async (e) => {
      if (!confirm(`Jetzt mit ${d.participants.length} Leuten auslosen?`)) return;
      const btn = e.currentTarget;
      busy(btn, true, "Namen werden gezogen…");
      try { await rpc("admin_draw", { p_admin_token: token }); toast("Ausgelost!"); await reload(); }
      catch (err) { const el = $("#drawerr"); el.textContent = err.message; el.hidden = false; busy(btn, false); }
    });
    $("#reset")?.addEventListener("click", (e) => {
      if (!confirm("Auslosung wirklich zurücksetzen?")) return;
      act(e.currentTarget, () => rpc("admin_reset_draw", { p_admin_token: token }), "Zurückgesetzt");
    });
    $("#edit").addEventListener("submit", (e) => {
      e.preventDefault();
      act(e.submitter, () => rpc("admin_update_group", {
        p_admin_token: token, p_name: $("#ename").value, p_budget: $("#ebudget").value,
        p_event_date: $("#edate").value, p_message: $("#emsg").value,
      }), "Gespeichert");
    });
  }

  // ---------- Router ----------
  function route() {
    const m = location.hash.match(/^#\/admin\/([a-f0-9]+)/);
    if (m) return adminView(m[1]);
    return startView();
  }
  window.addEventListener("hashchange", route);
  route();
})();
