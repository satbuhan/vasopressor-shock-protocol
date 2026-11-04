(function () {
  "use strict";

  // This tool's own slug, used to (a) skip self-links when another tool's
  // glossary term points back here and (b) build this tool's own deep links
  // when it's the one being pointed at. Every tool in the atlas sets this to
  // its own repo name.
  const TOOL_SLUG = "vasopressor-shock-protocol";

  /* The source figure's flow: a "Patient in SHOCK?" diamond gates entry —
     NO leads to an unconnected "Reassess" aside (drawn floating beside the
     diamond, no arrow of its own, so it's placed in the same 2-wide top
     group rather than given a vertical edge), YES leads to "Identify Shock
     Type & Resuscitate", which fans out to four shock-type category boxes
     (septic/vasodilatory, cardiogenic, haemorrhagic/hypovolaemic,
     obstructive) in one 4-wide row, each with its own matching treatment
     box directly beneath it in a second 4-wide row. All four treatment
     boxes converge on a "MAP ≥ 65 mmHg achieved?" diamond: YES exits
     sideways to "Continue & titrate" (same row, 2-wide group, matching the
     source's side-by-side placement), NO drops to "Add 2nd-line agent",
     which leads to a "Refractory shock?" diamond: YES exits sideways to
     the rescue-agents box (same row, 2-wide group), NO drops to the
     terminal "Stabilised — wean vasopressors" box. As with every other
     tool in the atlas, each edge below is computed independently by
     drawEdges() from live layout, so the 4-way fan-out/fan-in across the
     category and treatment rows needs no special handling. */
  const LAYOUT = {
    reassess:               { col: null, row: 1, group: "top" },
    "shock-decision":       { col: null, row: 1, group: "top", decision: true },
    "identify-resuscitate": { col: "full", row: 2 },

    "cat-septic":       { col: null, row: 3, group: "cat" },
    "cat-cardiogenic":  { col: null, row: 3, group: "cat" },
    "cat-haemorrhagic": { col: null, row: 3, group: "cat" },
    "cat-obstructive":  { col: null, row: 3, group: "cat" },

    "tx-septic":       { col: null, row: 4, group: "txc" },
    "tx-cardiogenic":  { col: null, row: 4, group: "txc" },
    "tx-haemorrhagic": { col: null, row: 4, group: "txc" },
    "tx-obstructive":  { col: null, row: 4, group: "txc" },

    "map-decision":     { col: null, row: 5, group: "map-row", decision: true },
    "continue-titrate": { col: null, row: 5, group: "map-row" },

    "add-second-line": { col: "full", row: 6 },

    "refractory-decision": { col: null, row: 7, group: "refr-row", decision: true },
    "rescue-agents":       { col: null, row: 7, group: "refr-row" },

    stabilised: { col: "full", row: 8 }
  };

  // How many columns each named group's wrapper subdivides into — picks
  // the matching CSS class (flow-wrap-N) in render() below.
  const GROUP_COLUMNS = { top: 2, cat: 4, txc: 4, "map-row": 2, "refr-row": 2 };

  const EDGES = [
    ["shock-decision", "reassess", "NO"],
    ["shock-decision", "identify-resuscitate", "YES"],
    ["identify-resuscitate", "cat-septic"],
    ["identify-resuscitate", "cat-cardiogenic"],
    ["identify-resuscitate", "cat-haemorrhagic"],
    ["identify-resuscitate", "cat-obstructive"],
    ["cat-septic", "tx-septic"],
    ["cat-cardiogenic", "tx-cardiogenic"],
    ["cat-haemorrhagic", "tx-haemorrhagic"],
    ["cat-obstructive", "tx-obstructive"],
    ["tx-septic", "map-decision"],
    ["tx-cardiogenic", "map-decision"],
    ["tx-haemorrhagic", "map-decision"],
    ["tx-obstructive", "map-decision"],
    ["map-decision", "continue-titrate", "YES"],
    ["map-decision", "add-second-line", "NO"],
    ["add-second-line", "refractory-decision"],
    ["refractory-decision", "rescue-agents", "YES"],
    ["refractory-decision", "stabilised", "NO"]
  ];

  const byId = {};
  NODES.forEach((n) => (byId[n.id] = n));

  /* ---- plain-text safety + glossary auto-linking ---- */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // longest match first, so a longer term wins over any shorter overlapping one
  const GLOSSARY_SORTED = GLOSSARY.slice().sort((a, b) => b.match.length - a.match.length);

  /* ---- agent (drug) name emphasis ----
     Rendering-only: wraps every case-insensitive, whole-word occurrence of
     a name in AGENTS (content.js) in a plain <strong class="agent-name">
     span — never a link/button, since this also runs inside the diagram
     .node <button>, where a nested interactive element would be invalid
     HTML. Unlike glossary terms, every occurrence is wrapped, not just the
     first, and label/sub text itself is never altered — only how it's
     rendered. */
  const AGENTS_SORTED = (typeof AGENTS !== "undefined" ? AGENTS : [])
    .slice()
    .sort((a, b) => b.length - a.length);

  function highlightAgentsHtml(rawText) {
    const text = escapeHtml(rawText);
    let result = "";
    let cursor = 0;
    while (cursor < text.length) {
      let best = null;
      for (const name of AGENTS_SORTED) {
        const re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        const m = re.exec(text.slice(cursor));
        if (
          m &&
          (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length))
        ) {
          best = { index: m.index, text: m[0] };
        }
      }
      if (!best) break;
      const matchStart = cursor + best.index;
      const matchEnd = matchStart + best.text.length;
      result += text.slice(cursor, matchStart);
      result += '<strong class="agent-name">' + best.text + "</strong>";
      cursor = matchEnd;
    }
    result += text.slice(cursor);
    return result;
  }

  /* ---- cross-atlas concept links ----
     A term that's independently glossary-defined in 2+ tools (checked and
     curated by hand when the index was built — same string, same clinical
     meaning, not just a coincidental match) gets a "Also covered in" line
     added under its definition, deep-linking straight to the other tool's
     node via its #node-<id> hash. Fetched once, best-effort: the page works
     identically if this never loads (slow network, offline, concepts.json
     unreachable) — it only adds a line that otherwise doesn't appear. */
  let CONCEPTS = null;
  let currentNodeId = null; // re-rendered once CONCEPTS loads, if a node is already open
  fetch("https://satbuhan.github.io/clinical-algorithm-atlas/assets/concepts.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      CONCEPTS = (data && data.terms) || {};
      if (currentNodeId) selectNode(currentNodeId);
    })
    .catch(() => {
      CONCEPTS = {};
    });

  // Other tools' occurrences of this same term, as an "Also covered in"
  // list — empty string if the index hasn't loaded yet, carries nothing to
  // show, or every occurrence is this tool itself.
  function crossLinksHtml(matchText) {
    if (!CONCEPTS) return "";
    const entries = CONCEPTS[matchText.toLowerCase().trim()];
    if (!entries) return "";
    const others = entries.filter((o) => o.tool !== TOOL_SLUG);
    if (!others.length) return "";
    const links = others
      .map((o) => {
        const href = o.nodeId ? o.url + "#node-" + o.nodeId : o.url;
        return '<a href="' + href + '">' + escapeHtml(o.title) + " →</a>";
      })
      .join(", ");
    return '<p class="term-crosslinks">Also covered in: ' + links + "</p>";
  }

  function linkify(rawText, usedTerms) {
    const text = escapeHtml(rawText);
    let result = "";
    let cursor = 0;
    // find the earliest, longest match from `cursor` onward across both
    // candidate pools: glossary terms (once per term, via usedTerms — a
    // repeated clickable button for a common phrase would be noisy) and
    // agent names (every occurrence, never deduped — plain emphasis, not
    // an interactive element, so repeating it is fine and desired).
    while (cursor < text.length) {
      let best = null;
      for (const g of GLOSSARY_SORTED) {
        if (usedTerms.has(g.match)) continue;
        const re = new RegExp("\\b" + g.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
        const m = re.exec(text.slice(cursor));
        if (
          m &&
          (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length))
        ) {
          best = { index: m.index, text: m[0], kind: "term", g };
        }
      }
      for (const name of AGENTS_SORTED) {
        const re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        const m = re.exec(text.slice(cursor));
        if (
          m &&
          (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length))
        ) {
          best = { index: m.index, text: m[0], kind: "agent" };
        }
      }
      if (!best) break;
      const matchStart = cursor + best.index;
      const matchEnd = matchStart + best.text.length;
      result += text.slice(cursor, matchStart);
      if (best.kind === "agent") {
        result += '<strong class="agent-name">' + best.text + "</strong>";
      } else {
        const g = best.g;
        const label = g.full ? g.full[0].toUpperCase() + g.full.slice(1) : "";
        result +=
          '<button type="button" class="term" aria-expanded="false">' +
          best.text +
          "</button>" +
          '<span class="term-def" hidden>' +
          (g.full ? "<strong>" + escapeHtml(label) + "</strong> — " : "") +
          escapeHtml(g.def) +
          crossLinksHtml(g.match) +
          "</span>";
        usedTerms.add(g.match);
      }
      cursor = matchEnd;
    }
    result += text.slice(cursor);
    return result;
  }

  const flowEl = document.getElementById("flow");
  const edgesSvg = document.getElementById("edges");

  function nodeEl(n) {
    const layout = LAYOUT[n.id] || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "node-" + n.id;
    btn.dataset.node = n.id;
    btn.setAttribute("aria-pressed", "false");

    let cls = "node";
    if (layout.decision) cls += " node--decision";
    if (n.type === "terminal") cls += " node--terminal";
    if (n.tone === "key") cls += " node--key";
    if (n.tone === "alarm") cls += " node--alarm";
    if (n.tone === "note") cls += " node--note";
    if (layout.col) cls += " " + layout.col;
    btn.className = cls;
    // Explicit row keeps every edge short and direct instead of relying
    // on implicit grid auto-placement. (Grouped nodes sit inside their
    // own flow-wrap-N subgrid, not the outer .flow grid, so the row goes
    // on the wrapper instead — see render().)
    if (layout.row && !layout.group) btn.style.gridRow = String(layout.row);

    const title = document.createElement("span");
    title.className = "node__title";
    title.innerHTML = highlightAgentsHtml(n.label);
    btn.appendChild(title);

    if (n.sub) {
      const sub = document.createElement("span");
      sub.className = "node__sub";
      sub.innerHTML = highlightAgentsHtml(n.sub);
      btn.appendChild(sub);
    }

    btn.addEventListener("click", () => selectNode(n.id));
    return btn;
  }

  function render() {
    // group ordinary nodes by document order, wrapping named groups in a
    // subgrid sized to that group's actual member count (the 3-wide
    // header/content rows, the 2x3 complications block).
    const seenGroups = {};
    NODES.forEach((n) => {
      const layout = LAYOUT[n.id] || {};
      if (layout.group) {
        let wrap = seenGroups[layout.group];
        if (!wrap) {
          wrap = document.createElement("div");
          const cols = GROUP_COLUMNS[layout.group] || 2;
          wrap.className = "flow-wrap-" + cols;
          // The wrapper itself sits in the outer .flow grid — its row
          // comes from the first grouped node's own `row`, since the
          // nodes inside share one wrapper position.
          if (layout.row) wrap.style.gridRow = String(layout.row);
          flowEl.appendChild(wrap);
          seenGroups[layout.group] = wrap;
        }
        wrap.appendChild(nodeEl(n));
      } else {
        flowEl.appendChild(nodeEl(n));
      }
    });
  }

  function clearActive() {
    document.querySelectorAll(".node.is-active").forEach((el) => {
      el.classList.remove("is-active");
      el.setAttribute("aria-pressed", "false");
    });
  }

  const readout = document.getElementById("readout");
  const readoutIdle = document.getElementById("readoutIdle");
  const readoutContent = document.getElementById("readoutContent");
  const readoutClose = document.getElementById("readoutClose");
  const backdrop = document.getElementById("backdrop");

  function kindTag(ids) {
    return ids
      .map((id) => '<a class="refchip" href="#ref-' + id + '">[' + id + "]</a>")
      .join("");
  }

  function renderDose(rows, usedTerms) {
    if (!rows) return "";
    const trs = rows
      .map(
        (r) =>
          "<tr><td>" +
          linkify(r[0], usedTerms) +
          "</td><td>" +
          linkify(r[1], usedTerms) +
          "</td></tr>"
      )
      .join("");
    return '<table class="dose-table"><tbody>' + trs + "</tbody></table>";
  }

  function selectNode(id) {
    const n = byId[id];
    if (!n) return;
    currentNodeId = id;
    clearActive();
    const el = document.getElementById("node-" + id);
    if (el) {
      el.classList.add("is-active");
      el.setAttribute("aria-pressed", "true");
    }

    readoutIdle.hidden = true;
    readoutContent.hidden = false;

    const usedTerms = new Set();

    let html = "";
    html += '<p class="readout__tag">' + escapeHtml(n.type) + "</p>";
    html += '<h2 class="readout__title">' + highlightAgentsHtml(n.label) + "</h2>";
    if (n.sub) html += '<p class="readout__sub">' + highlightAgentsHtml(n.sub) + "</p>";
    if (n.needsAuthor) {
      html +=
        '<span class="readout__flag">awaiting author citation</span>';
    }
    html += "<h3>What this means</h3><p>" + linkify(n.meaning, usedTerms) + "</p>";
    if (n.dose) {
      html += "<h3>Dosing, as authored</h3>" + renderDose(n.dose, usedTerms);
    }
    html += "<h3>Why</h3><p>" + linkify(n.rationale, usedTerms) + "</p>";
    if (n.cautions && n.cautions.length) {
      html +=
        "<h3>Cautions &amp; special populations</h3><ul class=\"caution-list\">" +
        n.cautions.map((c) => "<li>" + linkify(c, usedTerms) + "</li>").join("") +
        "</ul>";
    }
    html += "<h3>References</h3><div class=\"refchips\">" + kindTag(n.refs) + "</div>";

    readoutContent.innerHTML = html;

    if (window.matchMedia("(max-width: 900px)").matches) {
      readout.classList.add("is-open");
      backdrop.classList.add("is-open");
    }
  }

  function closeReadout() {
    readout.classList.remove("is-open");
    backdrop.classList.remove("is-open");
  }

  readoutContent.addEventListener("click", (e) => {
    const btn = e.target.closest(".term");
    if (!btn) return;
    const def = btn.nextElementSibling;
    if (!def || !def.classList.contains("term-def")) return;
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
    def.hidden = open;
  });

  readoutClose.addEventListener("click", closeReadout);
  backdrop.addEventListener("click", closeReadout);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReadout();
  });

  /* ---- references list ---- */
  function renderReferences() {
    const list = document.getElementById("referencesList");
    const count = document.getElementById("refCount");
    if (count) count.textContent = "(" + REFERENCES.length + ")";
    REFERENCES.forEach((r) => {
      const li = document.createElement("li");
      li.id = "ref-" + r.id;
      const linkHtml = r.url
        ? "<br><a href=\"" +
          r.url +
          '" target="_blank" rel="noopener">' +
          r.url +
          "</a>"
        : "";
      li.innerHTML =
        r.text + ' <span class="kind">' + r.kind + "</span>" + linkHtml;
      list.appendChild(li);
    });
  }

  /* ---- connector lines (desktop only) ---- */
  function pointAt(el, side) {
    const flowRect = flowEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = {
      left: r.left,
      right: r.right,
      center: (r.left + r.right) / 2
    };
    const y = {
      top: r.top,
      bottom: r.bottom,
      center: (r.top + r.bottom) / 2
    };
    return {
      x: x[side.x] - flowRect.left,
      y: y[side.y] - flowRect.top
    };
  }

  function drawEdges() {
    // Drawn on every viewport — mobile shows the identical diagram
    // inside a horizontally scrollable .scope, rather than a reflowed
    // linear stack, so the arrows are needed there too.
    const flowRect = flowEl.getBoundingClientRect();
    edgesSvg.setAttribute("width", flowRect.width);
    edgesSvg.setAttribute("height", flowRect.height);
    edgesSvg.setAttribute("viewBox", "0 0 " + flowRect.width + " " + flowRect.height);
    edgesSvg.innerHTML =
      '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#4A6684"/></marker></defs>';

    EDGES.forEach(([fromId, toId, label, variant]) => {
      const a = document.getElementById("node-" + fromId);
      const b = document.getElementById("node-" + toId);
      if (!a || !b) return;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();

      // Compare vertical CENTERS, not tops: a decision diamond uses
      // align-self:center (it doesn't stretch to the row's full height),
      // while an ordinary box with multi-line sub text can be taller than
      // the row's other cells and define the row height itself — so two
      // nodes genuinely on the same grid row can still have different
      // `top`s even though they're vertically centered on each other.
      const aCenterY = (ar.top + ar.bottom) / 2;
      const bCenterY = (br.top + br.bottom) / 2;

      let p1, p2;
      if (Math.abs(aCenterY - bCenterY) < 8) {
        // same row: connect sides
        p1 = pointAt(a, { x: ar.left < br.left ? "right" : "left", y: "center" });
        p2 = pointAt(b, { x: ar.left < br.left ? "left" : "right", y: "center" });
      } else {
        p1 = pointAt(a, { x: "center", y: "bottom" });
        p2 = pointAt(b, { x: "center", y: "top" });
      }

      const midY = (p1.y + p2.y) / 2;
      let d =
        Math.abs(p1.y - p2.y) < 4
          ? "M" + p1.x + "," + p1.y + " L" + p2.x + "," + p2.y
          : "M" + p1.x + "," + p1.y +
            " C" + p1.x + "," + midY + " " + p2.x + "," + midY + " " + p2.x + "," + p2.y;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "flow-edge" + (variant === "info" ? " is-info" : ""));
      if (variant !== "info") path.setAttribute("marker-end", "url(#arrow)");
      edgesSvg.appendChild(path);

      if (label) {
        const sameRow = Math.abs(p1.y - p2.y) < 4;
        const lx = sameRow ? (p1.x + p2.x) / 2 : p2.x + (p1.x > p2.x ? -10 : 10);
        const ly = sameRow ? p1.y - 8 : p1.y + (p2.y - p1.y) * 0.22;

        // Label background scales with text length.
        const labelW = Math.max(28, label.length * 6.1 + 12);

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bg.setAttribute("class", "edge-label-bg");
        bg.setAttribute("x", lx - labelW / 2);
        bg.setAttribute("y", ly - 11);
        bg.setAttribute("width", labelW);
        bg.setAttribute("height", 14);
        edgesSvg.appendChild(bg);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "edge-label");
        text.setAttribute("x", lx);
        text.setAttribute("y", ly);
        text.setAttribute("text-anchor", "middle");
        text.textContent = label;
        edgesSvg.appendChild(text);
      }
    });
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawEdges, 120);
  });

  render();
  renderReferences();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(drawEdges);
  }
  window.addEventListener("load", drawEdges);
  drawEdges();

  // Deep link support: "#node-<id>" (matching each node button's own DOM
  // id) opens that node's readout and scrolls it into view on arrival —
  // what the cross-atlas "Also covered in" links above point at, so a
  // click lands on the right box instead of just the other tool's
  // homepage. Harmless on a plain, hash-free visit.
  const linkedNodeId = window.location.hash.replace(/^#node-/, "");
  if (linkedNodeId && byId[linkedNodeId]) {
    selectNode(linkedNodeId);
    window.addEventListener("load", () => {
      const el = document.getElementById("node-" + linkedNodeId);
      if (el) el.scrollIntoView({ block: "center", inline: "center" });
    });
  }
})();
