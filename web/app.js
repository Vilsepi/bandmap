// ── Bandmap Graph Explorer ───────────────────────────────
// Loads bandgraph_d3.json once, then renders ego-graphs
// (selected band + 1-hop neighbors) with D3 force layout.

(async function () {
  "use strict";

  // ── Load data ────────────────────────────────────────
  const resp = await fetch("data/bands.json.gz");
  if (!resp.ok) {
    document.getElementById("band-name").textContent = "Failed to load data";
    return;
  }
  const data = await resp.json();

  // ── Build indices ────────────────────────────────────
  const nodeById = new Map();          // id → node object
  const adjacency = new Map();         // id → Set<neighbor id>
  const edgeIndex = new Map();         // "lo-hi" → edge object

  for (const n of data.nodes) {
    nodeById.set(n.id, n);
    adjacency.set(n.id, new Set());
  }

  for (const e of data.links) {
    const s = e.source, t = e.target;
    adjacency.get(s)?.add(t);
    adjacency.get(t)?.add(s);
    const key = s < t ? `${s}-${t}` : `${t}-${s}`;
    edgeIndex.set(key, e);
  }

  // Sorted node list for search
  const sortedNodes = [...data.nodes].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
  );

  // ── Genre → color mapping ───────────────────────────
  const genreKeywords = [
    "Black", "Death", "Doom", "Thrash", "Power", "Heavy",
    "Progressive", "Folk", "Symphonic", "Gothic", "Grind",
    "Speed", "Sludge", "Stoner", "Melodic", "Avant-garde",
    "Industrial", "Atmospheric", "Post", "Viking", "Pagan",
  ];
  const palette = [
    "#14be72", "#23875a", "#279588", "#309095", "#2f6097",
    "#826d5b", "#06b6d4", "#22c55e", "#6c3d9b", "#6366f1",
    "#84cc16", "#43914c", "#78716c", "#a77134", "#14b8a6",
    "#8b5cf6", "#64748b", "#2a7eab", "#5c36ba", "#32a43c",
    "#10b981",
  ];
  const genreColor = new Map();
  genreKeywords.forEach((g, i) => genreColor.set(g.toLowerCase(), palette[i % palette.length]));

  function bandColor(node) {
    const g = (node.genres || "").toLowerCase();
    for (const [kw, c] of genreColor) {
      if (g.includes(kw)) return c;
    }
    return "#94a3b8"; // default grey
  }

  // ── SVG setup ────────────────────────────────────────
  const svg = d3.select("#graph");
  const width = window.innerWidth;
  const height = window.innerHeight;
  svg.attr("viewBox", [0, 0, width, height]);

  const g = svg.append("g"); // zoom container

  const zoom = d3.zoom()
    .scaleExtent([0.3, 4])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom);

  let linkG = g.append("g").attr("class", "links");
  let nodeG = g.append("g").attr("class", "nodes");

  let simulation = null;

  // ── UI elements ──────────────────────────────────────
  const elName = document.getElementById("band-name");
  const elCountry = document.getElementById("band-country");
  const elGenres = document.getElementById("band-genres");
  const spotifyLink = document.getElementById("spotify-link");
  const metalArchivesLink = document.getElementById("band-link");
  const tooltip = document.getElementById("tooltip");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  function toSpotifyQuery(name) {
    return encodeURIComponent(
      (name || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
    );
  }

  // ── Responsive settings ──────────────────────────────
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const MAX_NEIGHBORS = isMobile ? 20 : 50;

  // ── Extract ego-graph ────────────────────────────────
  function egoGraph(centerId) {
    const neighborIds = adjacency.get(centerId);
    if (!neighborIds) return { nodes: [], links: [] };

    // Rank neighbors by edge score (highest first), then cap
    let ranked = [...neighborIds].map((nid) => {
      const key = centerId < nid ? `${centerId}-${nid}` : `${nid}-${centerId}`;
      const score = edgeIndex.get(key)?.score ?? 0;
      return { id: nid, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length > MAX_NEIGHBORS) ranked = ranked.slice(0, MAX_NEIGHBORS);

    const idSet = new Set([centerId, ...ranked.map((r) => r.id)]);

    const nodes = [];
    for (const id of idSet) {
      const n = nodeById.get(id);
      if (n) nodes.push({ ...n });
    }

    const links = [];
    const seen = new Set();
    for (const id of idSet) {
      for (const nid of adjacency.get(id) || []) {
        if (!idSet.has(nid)) continue;
        const key = id < nid ? `${id}-${nid}` : `${nid}-${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const orig = edgeIndex.get(key);
        links.push({ source: id, target: nid, score: orig?.score ?? null });
      }
    }

    return { nodes, links };
  }

  // ── Render ───────────────────────────────────────────
  let currentCenter = null;

  function render(centerId, { updateHash = true } = {}) {
    currentCenter = centerId;
    if (updateHash) history.replaceState(null, "", `#${centerId}`);
    const ego = egoGraph(centerId);
    const centerNode = nodeById.get(centerId);

    // Update info panel
    elName.textContent = centerNode?.name || `#${centerId}`;
    metalArchivesLink.href = centerNode?.url || `https://www.metal-archives.com/bands/_/${centerId}`;
    spotifyLink.href = `https://open.spotify.com/search/${toSpotifyQuery(centerNode?.name || String(centerId))}`;
    elCountry.textContent = centerNode?.country || "";
    elGenres.textContent = centerNode?.genres || "";

    // Stop previous simulation
    if (simulation) simulation.stop();

    // Node radius based on similarity score of incident edges in this ego-graph
    const similarityByNode = new Map();
    for (const node of ego.nodes) similarityByNode.set(node.id, 0);

    for (const link of ego.links) {
      const score = Number(link.score) || 0;
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      similarityByNode.set(sourceId, Math.max(similarityByNode.get(sourceId) || 0, score));
      similarityByNode.set(targetId, Math.max(similarityByNode.get(targetId) || 0, score));
    }

    const similarityValues = [...similarityByNode.values()];
    const maxSimilarity = d3.max(similarityValues) || 1;

    const rScale = d3.scaleSqrt()
      .domain([0, maxSimilarity])
      .range([6, 22]);

    // ── Links ──────────────────────────────────────────
    linkG.selectAll("*").remove();
    const linkSel = linkG
      .selectAll("line")
      .data(ego.links, (d) => `${d.source}-${d.target}`)
      .join("line")
      .attr("class", (d) => {
        const s = typeof d.source === "object" ? d.source.id : d.source;
        const t = typeof d.target === "object" ? d.target.id : d.target;
        return (s === centerId || t === centerId) ? "link center-link" : "link";
      });

    // ── Nodes ──────────────────────────────────────────
    nodeG.selectAll("*").remove();
    const nodeSel = nodeG
      .selectAll("g")
      .data(ego.nodes, (d) => d.id)
      .join("g")
      .attr("class", (d) => (d.id === centerId ? "node center" : "node"))
      .call(
        d3.drag()
          .on("start", dragStart)
          .on("drag", dragging)
          .on("end", dragEnd)
      );

    nodeSel
      .append("circle")
      .attr("r", (d) => {
        const base = rScale(similarityByNode.get(d.id) || 0);
        return d.id === centerId ? base + 4 : base;
      })
      .attr("fill", (d) => bandColor(d));

    nodeSel
      .append("text")
      .attr("dy", (d) => rScale(similarityByNode.get(d.id) || 0) + (d.id === centerId ? 20 : 14))
      .text((d) => truncate(d.name || `#${d.id}`, 22));

    // Click → recenter
    nodeSel.on("click", (event, d) => {
      event.stopPropagation();
      render(d.id);
      resetZoom();
    });

    // Hover tooltip
    nodeSel
      .on("mouseenter", (event, d) => {
        tooltip.innerHTML = `
          <div class="tt-name">${esc(d.name || `#${d.id}`)}</div>
          <div class="tt-detail">${esc(d.country || "")}</div>
          <div class="tt-detail">${esc(d.genres || "")}</div>
        `;
        tooltip.classList.add("visible");
      })
      .on("mousemove", (event) => {
        tooltip.style.left = event.clientX + 14 + "px";
        tooltip.style.top = event.clientY - 10 + "px";
      })
      .on("mouseleave", () => tooltip.classList.remove("visible"));

    // ── Force simulation ───────────────────────────────
    simulation = d3
      .forceSimulation(ego.nodes)
      .force("link", d3.forceLink(ego.links).id((d) => d.id).distance(isMobile ? 120 : 150))
      .force("charge", d3.forceManyBody().strength(isMobile ? -300 : -200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d) => rScale(similarityByNode.get(d.id) || 0) + 8))
      .on("tick", () => {
        linkSel
          .attr("x1", (d) => d.source.x)
          .attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y);

        nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });

    // Pin center node
    const cn = ego.nodes.find((n) => n.id === centerId);
    if (cn) {
      cn.fx = width / 2;
      cn.fy = height / 2;
    }
  }

  // ── Drag handlers ────────────────────────────────────
  function dragStart(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragging(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnd(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    // Keep center node pinned, release others
    if (d.id !== currentCenter) {
      d.fx = null;
      d.fy = null;
    }
  }

  // ── Zoom reset ───────────────────────────────────────
  const defaultZoom = isMobile
    ? d3.zoomIdentity
    : d3.zoomIdentity.translate(width / 2, height / 2).scale(1.5).translate(-width / 2, -height / 2);

  function resetZoom() {
    svg.transition().duration(500).call(zoom.transform, defaultZoom);
  }

  // ── Search ───────────────────────────────────────────
  let activeResultIdx = -1;

  function updateActiveResult() {
    const items = searchResults.querySelectorAll("li");
    items.forEach((li, i) => {
      li.classList.toggle("active", i === activeResultIdx);
    });
    // Scroll the active item into view within the dropdown
    if (activeResultIdx >= 0 && items[activeResultIdx]) {
      items[activeResultIdx].scrollIntoView({ block: "nearest" });
    }
  }

  function selectResult(id) {
    if (nodeById.has(id)) {
      render(id);
      resetZoom();
    }
    searchInput.value = "";
    searchResults.classList.remove("visible");
    searchResults.innerHTML = "";
    activeResultIdx = -1;
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    activeResultIdx = -1;
    if (q.length < 2) {
      searchResults.classList.remove("visible");
      searchResults.innerHTML = "";
      return;
    }
    const matches = sortedNodes
      .filter((n) => (n.name || "").toLowerCase().includes(q))
      .slice(0, 20);
    if (matches.length === 0) {
      searchResults.classList.remove("visible");
      searchResults.innerHTML = "";
      return;
    }
    searchResults.innerHTML = matches
      .map(
        (n) =>
          `<li data-id="${n.id}">${esc(n.name)}<span class="sr-country">${esc(n.country || "")}</span></li>`
      )
      .join("");
    searchResults.classList.add("visible");
  });

  searchInput.addEventListener("keydown", (e) => {
    const items = searchResults.querySelectorAll("li");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeResultIdx = Math.min(activeResultIdx + 1, items.length - 1);
      updateActiveResult();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeResultIdx = Math.max(activeResultIdx - 1, 0);
      updateActiveResult();
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If an item is highlighted use it, otherwise pick the first result
      const idx = activeResultIdx >= 0 ? activeResultIdx : 0;
      const li = items[idx];
      if (li) selectResult(Number(li.dataset.id));
    }
  });

  searchResults.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectResult(Number(li.dataset.id));
  });

  // Close search on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#control-panel")) {
      searchResults.classList.remove("visible");
    }
  });

  // ── Helpers ──────────────────────────────────────────
  function truncate(s, max) {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  // ── Random band picker ───────────────────────────────
  const candidates = data.nodes.filter((n) => (adjacency.get(n.id)?.size || 0) >= 3);

  function pickRandom() {
    const pool = candidates.length > 0 ? candidates : data.nodes;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    render(pick?.id);
    resetZoom();
  }

  document.getElementById("random-btn").addEventListener("click", pickRandom);

  // ── Pick initial band (or from URL hash) ────────────
  function bandIdFromHash() {
    const h = location.hash.replace(/^#/, "");
    const id = Number(h);
    return id && nodeById.has(id) ? id : null;
  }

  const initialId = bandIdFromHash();
  if (initialId) {
    render(initialId);
    resetZoom();
  } else {
    pickRandom();
  }

  window.addEventListener("hashchange", () => {
    const id = bandIdFromHash();
    if (id && id !== currentCenter) {
      render(id, { updateHash: false });
      resetZoom();
    }
  });

  // ── Handle resize ────────────────────────────────────
  window.addEventListener("resize", () => {
    svg.attr("viewBox", [0, 0, window.innerWidth, window.innerHeight]);
  });
})();
