/* ======================================================================
   KOЯD · script.js  -  (the whole app in 7 parts)

   PART 1  MEMORY .... variables the app remembers (which song, playing or not)
   PART 2  PLAYER .... play, pause, next, previous
   PART 3  PLAYLISTS . make your own playlists and save them to playlists.js
   PART 4  SCREENS ... draws Home, Playlist, Search, Library, Liked Songs
   PART 5  LYRICS .... Now Playing page, lyrics sync, smooth scrolling
   PART 6  BUTTONS ... progress bar, volume, keyboard, button clicks
   PART 7  START ..... the two lines that run when the page opens

   THE BIG IDEA (say this first):
   "The app keeps notes in variables (Part 1). When something changes, we
    update the notes and call render() (Part 4), which redraws the screen
    from those notes. Nothing reloads, so the music never stops."
   ====================================================================== */

/* ======================================================================
   PART 1 - MEMORY
   Purpose: the app's "notes to itself". These variables always say what is
   happening right now. Every other part reads or changes them.
   ====================================================================== */
let cur = -1;                 // which song is current (its number in songs.js). -1 = none yet
let playing = false;         // is music playing right now? (true / false)
let pos = 0;                  // how many seconds of the song have played
let shuffle = false, repeat = false;   // are Shuffle and Repeat switched on?
let view = "home", query = "";   // view = which screen is showing, query = what you typed in Search
let lastLine = -1;            // which lyric line is lit up right now
const liked = new Set();      // the songs you pressed ♡ on

// Hide empty songs (no title) from the app. This does NOT change songs.js.
for (let i = songs.length - 1; i >= 0; i--) if (!songs[i].t) songs.splice(i, 1);

// Shortcut: $("pp") means "find the HTML element that has id pp"
const $ = id => document.getElementById(id);
// Turns seconds into minutes:seconds. Example: 231 becomes 3:51
const fmt = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

// COVER ART: bg() picks the picture, or a colored gradient if the song has no picture.
// cover() builds the small square (gradient squares show the song's first letter).
const bg = s => s.img ? `url(${s.img}) center/cover,#1a1a1a`
  : `linear-gradient(135deg,hsl(${s.h} 75% 50%),hsl(${s.h + 30} 70% 15%))`;
const cover = s => `<div class="cover" style="background:${bg(s)}">${s.img ? "" : `<span>${s.t[0] || "♪"}</span>`}</div>`;

/* ======================================================================
   PART 2 - PLAYER
   Purpose: the music engine. Starting a song, pause/resume, next, previous.
   ====================================================================== */
const audio = new Audio();                            // the browser's built-in audio player (plays the mp3 files)
const hasAudio = () => cur >= 0 && songs[cur].src;    // true if the current song has an audio file
// Jump to a time (in seconds) in the song
function seek(t) { pos = t; if (hasAudio()) audio.currentTime = t; updateProgress(); }

// Start song number i from the beginning: load the file, play it, change the page color, redraw.
function playSong(i) {
  cur = i; pos = 0; playing = true;
  audio.pause();
  if (songs[i].src) { audio.src = songs[i].src; audio.play().catch(() => {}); }
  document.documentElement.style.setProperty("--hue", songs[i].h);  // page color follows the song
  renderLyrics();
  render();
}
// Used when YOU click a song or a Play button: it plays the song AND opens the Now Playing page.
// (When a song ends and the next one starts by itself, the page does not pop open.)
function playFrom(i, from) {
  // from = which playlist we are playing from (null = all songs). If not given, use the page you are on.
  playingFrom = from !== undefined ? from : (view.startsWith("pl:") ? view.slice(3) : null);
  if (i !== cur) playSong(i);
  else if (!playing) togglePlay();
  openNow(0);
}
// Play / Pause button: switches between playing and paused.
function togglePlay() {
  if (cur < 0) return playFrom(0);
  playing = !playing;
  if (hasAudio()) playing ? audio.play().catch(() => {}) : audio.pause();
  render();
}
// The list of songs that Next and Previous walk through: your playlist if you started one, otherwise all songs.
const queueOrder = () => {
  const p = playingFrom && plById(playingFrom), idx = p ? plSongs(p) : [];
  return idx.length ? idx : songs.map((_, i) => i);
};
// Next button (auto = true when a song ends by itself). Goes to the next song, or a random one if Shuffle is on.
// At the end of the list it stops, unless Repeat is on.
function next(auto) {
  const order = queueOrder();
  let n = shuffle ? order[Math.floor(Math.random() * order.length)] : order[order.indexOf(cur) + 1];
  if (n === undefined) {
    if (repeat || !auto) n = order[0];
    else { playing = false; pos = 0; audio.pause(); return render(); }   // reached the end: stop
  }
  playSong(n);
}
// Previous button: if more than 3 seconds have played, restart the song. Otherwise go back one song.
function prev() {
  if (cur < 0) return playSong(0);
  if (pos > 3) return seek(0);
  const order = queueOrder();
  playSong(order[(order.indexOf(cur) - 1 + order.length) % order.length]);
}

// Timer for songs that have NO audio file: it "pretends" to play by counting one second at a time.
// (Real songs are tracked by audio.ontimeupdate in Part 6.)
setInterval(() => {
  if (!playing || hasAudio()) return;
  pos++;
  if (pos >= songs[cur].d) next(true); else updateProgress();
}, 1000);

/* ======================================================================
   PART 3 - PLAYLISTS
   Purpose: lets you create your own playlists, add songs, and save them
   to the file playlists.js so they are kept.
     3A  the playlist notes + small helpers
     3B  loading and saving
     3C  actions (create, add/remove, delete, play)
     3D  the pop-up windows
   ====================================================================== */

/* ----- 3A. Playlist notes and small helpers ----- */
let playlists = [];                 // all your playlists: [{ id, name, songs: ["songs/a.mp3", ...] }]
let playlistsUpdated = 0;           // time of the last change (tells us whether the file or the browser copy is newer)
let playingFrom = null;             // which playlist is playing now (null = all songs)
let saveState = "none";             // none = no changes | dirty = not saved to the file yet | linked = saves by itself | downloaded
let fileHandle = null;              // the playlists.js file, once you pick it (Chrome / Edge only)

const songKey = s => s.src || s.t;                       // a playlist remembers a song by its file path
// find a playlist by its id
const plById = id => playlists.find(p => p.id === id);
const plSongs = p => p.songs.map(k => songs.findIndex(s => songKey(s) === k)).filter(i => i >= 0);   // turns a playlist's saved file paths into song numbers
// total minutes of a list of songs
const minsOf = idxs => idxs.length ? Math.max(1, Math.round(idxs.reduce((t, i) => t + songs[i].d, 0) / 60)) : 0;
// makes text safe to show on the page (so a name like <b> cannot break the layout)
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ----- 3B. Loading and saving ----- */

// When the page opens: load playlists from playlists.js (or from the browser, if it has newer changes).
function loadPlaylists() {
  let data = typeof playlistsFile !== "undefined" ? playlistsFile : { updated: 0, list: [] };
  try {
    const local = JSON.parse(localStorage.getItem("kordPlaylists"));
    if (local && local.updated > data.updated) { data = local; saveState = "dirty"; }
  } catch (e) {}
  playlists = JSON.parse(JSON.stringify(data.list));
  playlistsUpdated = data.updated;
}

// Runs after EVERY change: keeps a copy in the browser, and also writes the file if it is connected.
function savePlaylists() {
  playlistsUpdated = Date.now();
  try { localStorage.setItem("kordPlaylists", JSON.stringify({ updated: playlistsUpdated, list: playlists })); } catch (e) {}
  saveState = "dirty";
  if (fileHandle) saveToFile(); else render();
}

const fileText = () => `// Your custom playlists. KOЯD rewrites this file when you press "Save to file".
// Songs are remembered by their audio path (src in songs.js), so you can reorder songs.js safely.
const playlistsFile = ${JSON.stringify({ updated: playlistsUpdated, list: playlists }, null, 2)};
`;

// Backup way to save: the browser downloads playlists.js, then you put it in your kord folder.
function downloadFile(text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  a.download = "playlists.js"; a.click();
  saveState = "downloaded";
}

// The "Save to file" button. Chrome / Edge: you pick playlists.js ONCE, then it saves by itself.
// Other browsers: it downloads playlists.js, and you replace the old one in your kord folder.
async function saveToFile() {
  const text = fileText();
  try {
    if (window.showSaveFilePicker) {
      if (!fileHandle) fileHandle = await showSaveFilePicker({ suggestedName: "playlists.js", types: [{ description: "playlists.js", accept: { "text/javascript": [".js"] } }] });
      const w = await fileHandle.createWritable();
      await w.write(text); await w.close();
      saveState = "linked";
    } else downloadFile(text);
  } catch (e) {
    fileHandle = null;
    if (e.name !== "AbortError") downloadFile(text);   // could not write directly, so download instead
  }
  render();
}

// The small box that tells you whether your playlists are saved yet
function saveBar() {
  if (!playlists.length) return "";
  const msg = { none: "Loaded from playlists.js", dirty: "Not saved to playlists.js yet",
    linked: "Saved to playlists.js ✓ (saves automatically)", downloaded: "Downloaded. Put playlists.js in your kord folder." }[saveState];
  return `<div class="save-bar ${saveState}"><small>${msg}</small><button class="btn ghost small" onclick="saveToFile()">💾 Save to file</button></div>`;
}

/* ----- 3C. Actions ----- */

// Makes a new playlist (it can start with one song already inside)
function createPlaylist(name, songIdx) {
  const p = { id: "p" + Date.now().toString(36), name: name.trim() || "My Playlist " + (playlists.length + 1), songs: [] };
  if (songIdx !== undefined) p.songs.push(songKey(songs[songIdx]));
  playlists.push(p);
  savePlaylists();
  return p;
}
// Add song i to the playlist if it is not in it, or remove it if it is
function toggleInPlaylist(id, i) {
  const p = plById(id), k = songKey(songs[i]), at = p.songs.indexOf(k);
  at >= 0 ? p.songs.splice(at, 1) : p.songs.push(k);
  savePlaylists();
}
// Deletes a playlist (your songs stay)
function deletePlaylist(id) {
  playlists = playlists.filter(p => p.id !== id);
  if (view === "pl:" + id) view = "home";
  if (playingFrom === id) playingFrom = null;
  closeDialog(); savePlaylists();
}
// The big ▶ on a playlist: starts it from its first song. v = "playlist" (all songs) or "pl:<id>" (your own)
function playPlaylist(v) {
  const id = v.startsWith("pl:") ? v.slice(3) : null;
  const idxs = id ? plSongs(plById(id)) : songs.map((_, i) => i);
  if (idxs.length) playFrom(idxs.includes(cur) && playingFrom === id ? cur : idxs[0], id);
}

/* ----- 3D. Pop-up windows (the <dialog> in index.html): new, rename, delete, add songs ----- */
const dlg = $("dlg");
// openDialog shows a pop-up with the HTML we give it; closeDialog hides it
const openDialog = html => { dlg.innerHTML = html; dlg.showModal(); };
const closeDialog = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });   // clicking the dark area outside also closes it

// "New playlist" pop-up (songIdx = optional song to put in it)
function newPlaylistDialog(songIdx) {
  openDialog(`<form onsubmit="event.preventDefault();submitNew(${songIdx === undefined ? "undefined" : songIdx})">
    <h3>New playlist</h3>
    <input id="pl-name" maxlength="40" placeholder="Playlist name" autocomplete="off" autofocus>
    <div class="dlg-actions"><button type="button" class="btn ghost" onclick="closeDialog()">Cancel</button><button class="btn primary">Create</button></div>
  </form>`);
}
// Create button: makes the playlist, then opens it so you can pick songs
function submitNew(songIdx) {
  const p = createPlaylist($("pl-name").value, songIdx);
  closeDialog();
  if (songIdx === undefined) { go("pl:" + p.id); addSongsDialog(p.id); }   // open the new playlist and show the song picker
}
// Rename pop-up
function renameDialog(id) {
  openDialog(`<form onsubmit="event.preventDefault();renamePlaylist('${id}')">
    <h3>Rename playlist</h3>
    <input id="pl-name" maxlength="40" value="${esc(plById(id).name)}" autocomplete="off" autofocus>
    <div class="dlg-actions"><button type="button" class="btn ghost" onclick="closeDialog()">Cancel</button><button class="btn primary">Save</button></div>
  </form>`);
}
function renamePlaylist(id) {
  plById(id).name = $("pl-name").value.trim() || plById(id).name;
  closeDialog(); savePlaylists();
}
// "Are you sure?" pop-up before deleting
function deleteDialog(id) {
  openDialog(`<h3>Delete “${esc(plById(id).name)}”?</h3><p class="dlg-note">Your songs stay in KOЯD. Only the playlist is removed.</p>
    <div class="dlg-actions"><button class="btn ghost" onclick="closeDialog()">Cancel</button><button class="btn primary" onclick="deletePlaylist('${id}')">Delete</button></div>`);
}
// Song picker for one playlist: tick the songs you want inside it
function addSongsDialog(id) {
  const p = plById(id);
  openDialog(`<h3>Add songs to “${esc(p.name)}”</h3><div class="pick-list">` + songs.map((s, i) =>
    `<label class="pick">${cover(s)}<div><b>${esc(s.t)}</b><small>${esc(s.a)}</small></div>
      <input type="checkbox" ${p.songs.includes(songKey(s)) ? "checked" : ""} onchange="toggleInPlaylist('${id}',${i})"></label>`).join("") +
    `</div><div class="dlg-actions"><button class="btn primary" onclick="closeDialog()">Done</button></div>`);
}
// Opens from the ＋ on a song row: tick which playlists this song belongs to
function addToPlaylistDialog(i) {
  openDialog(`<h3>Add “${esc(songs[i].t)}” to…</h3><div class="pick-list">` + (playlists.length ? playlists.map(p =>
    `<label class="pick"><div><b>${esc(p.name)}</b><small>${p.songs.length} songs</small></div>
      <input type="checkbox" ${p.songs.includes(songKey(songs[i])) ? "checked" : ""} onchange="toggleInPlaylist('${p.id}',${i})"></label>`).join("")
      : `<p class="dlg-note">You have no playlists yet.</p>`) +
    `</div><div class="dlg-actions"><button class="btn ghost" onclick="newPlaylistDialog(${i})">＋ New playlist</button><button class="btn primary" onclick="closeDialog()">Done</button></div>`);
}

/* ======================================================================
   PART 4 - SCREENS
   Purpose: builds what you SEE. Small reusable pieces first (4A),
   then render() (4B), which puts the right screen on the page.
   ====================================================================== */

/* ----- 4A. Small reusable pieces ----- */
// every song as { s: the song, i: its number }
const all = () => songs.map((s, i) => ({ s, i }));

const eq = `<i class="eq"><b></b><b></b><b></b></i>`;   // the little moving bars shown next to the song that is playing

// A playlist's picture: 4 covers in a 2x2 grid (or a ♪ tile if the playlist is empty)
const mosaicOf = (idxs, cls = "") => idxs.length
  ? `<div class="mosaic ${cls}">${[0, 1, 2, 3].map(n => cover(songs[idxs[n % idxs.length]])).join("")}</div>`
  : `<div class="mosaic empty ${cls}">♪</div>`;

// The wide playlist card on the Home page (v = "playlist" or "pl:<id>")
const plBanner = (name, idxs, v) => `
  <div class="pl-banner" onclick="go('${v}')">
    ${mosaicOf(idxs)}
    <div class="pl-text"><span class="eyebrow">PLAYLIST</span><h3>${esc(name)}</h3><small>${idxs.length} songs${idxs.length ? " · " + minsOf(idxs) + " min" : ""}</small></div>
    <button class="go" onclick="event.stopPropagation();playPlaylist('${v}')">▶</button>
  </div>`;

// One playlist row in the left sidebar
const libItem = (v, icon, name, sub) =>
  `<button class="libitem" data-view="${v}" onclick="go('${v}')">${icon}<div><b>${name}</b><small>${sub}</small></div></button>`;
// a plain colored square used as a cover
const gradCover = (a, b) => `<div class="cover" style="background:linear-gradient(135deg,${a},${b})"></div>`;

// Fills the playlist list in the left sidebar
function renderSidebar() {
  $("plist").innerHTML =
    libItem("playlist", gradCover("#e5239d", "#3a0a2b"), "Our Playlist", "Playlist · KOЯD") +
    libItem("liked", gradCover("#7b2ff7", "#e5239d"), "Liked Songs", "Playlist") +
    playlists.map(p => { const idxs = plSongs(p);
      return libItem("pl:" + p.id, idxs.length ? cover(songs[idxs[0]]) : gradCover("#444", "#222"), esc(p.name), `Playlist · ${idxs.length} songs`); }).join("") +
    saveBar();
}

// One song card (used in "Your songs" on the Home page)
const card = (s, i) => `
  <div class="card ${i === cur ? "current" : ""}" onclick="playFrom(${i})">
    <div class="art">${cover(s)}<button class="go">▶</button></div>
    <b>${s.t}</b><small>${s.a}</small>
  </div>`;

// The song table (used on Playlist, Search and Liked pages). Each row = cover, title, buttons, length.
// plId is only given inside your own playlist, so the ✕ remove button shows.
function trackList(list, plId) {
  return `<div class="tr head"><span class="num">#</span><span>Title</span><span class=""></span><span>⏱</span></div>` +
    list.map(({ s, i }, n) => `
    <div class="tr ${i === cur ? "current" : ""}" onclick="playFrom(${i})">
      <span class="num"><span>${i === cur && playing ? eq : n + 1}</span><span class="play">▶</span></span>
      <div class="song">${cover(s)}<div style="min-width:0"><b>${s.t}</b><small>${s.a}</small></div></div>
      <span class=">${s.al}</span>
      <span class="end">
        <button class="heart" title="Add to playlist" onclick="event.stopPropagation();addToPlaylistDialog(${i})">＋</button>
        ${plId ? `<button class="heart" title="Remove from this playlist" onclick="event.stopPropagation();toggleInPlaylist('${plId}',${i})">✕</button>` : ""}
        <button class="heart ${liked.has(i) ? "on" : ""}" onclick="event.stopPropagation();like(${i})">${liked.has(i) ? "♥" : "♡"}</button>
        <span class="dur">${fmt(s.d)}</span>
      </span>
    </div>`).join("");
}

/* ----- 4B. render(): redraws the screen ----- */

// render() runs after ANYTHING changes. It works in 3 steps:
//   Step 1  build the HTML for the current screen (home, playlist, search ...)
//   Step 2  put that HTML on the page
//   Step 3  update the sidebar and the player bar at the bottom
function render() {
  let html = "";
  const hr = new Date().getHours();
  const hello = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";

  // ----- Step 1: build the screen -----
  if (view === "home") {               // HOME: banner, your songs, playlists
    const fi = cur >= 0 ? cur : 0, f = songs[fi];      // the big banner shows the playing song (or the first song)
    const mins = Math.round(songs.reduce((t, x) => t + x.d, 0) / 60);
    const isPlay = cur === fi && playing;
    // (4 small covers; repeats songs if there are fewer than 4)
    const mosaic = [0, 1, 2, 3].map(n => cover(songs[n % songs.length])).join("");
    html = `<div class="pad">
      <p class="greet">${hello}</p>
      <div class="featured">
        ${f.img ? `<div class="f-bg" style="background-image:url(${f.img})"></div>` : ""}
        <div class="cover f-cover" style="background:${bg(f)}">${f.img ? "" : `<span>${f.t[0]}</span>`}</div>
        <div class="f-text">
          <span class="eyebrow">${cur >= 0 ? "NOW PLAYING" : "FEATURED"}</span>
          <h2 class="f-title">${f.t}</h2>
          <p class="f-sub">${f.a} · ${f.al}</p>
          <div class="f-actions">
            <button class="btn primary" onclick="${isPlay ? "togglePlay()" : `playFrom(${fi})`}">${isPlay ? "❚❚ Pause" : "▶ Play"}</button>
            <button class="btn ghost ${shuffle ? "on" : ""}" onclick="toggleShuffle()">⤮ Shuffle</button>
            <button class="btn round ghost ${liked.has(fi) ? "on" : ""}" onclick="like(${fi})" title="Like">${liked.has(fi) ? "♥" : "♡"}</button>
          </div>
        </div>
      </div>

      <div class="section-head"><h2>Your songs</h2><small>${songs.length} songs · ${mins} min</small></div>
      <div class="cards">${songs.map(card).join("")}</div>

      <div class="section-head"><h2>Playlists</h2><button class="btn ghost small" onclick="newPlaylistDialog()">＋ New playlist</button></div>
      <div class="pl-grid">
        ${plBanner("Our Playlist", songs.map((_, i) => i), "playlist")}
        ${playlists.map(p => plBanner(p.name, plSongs(p), "pl:" + p.id)).join("")}
      </div>
      ${saveBar()}
    </div>`;
  } else if (view === "playlist") {    // "OUR PLAYLIST" page (all songs)
    html = `<div class="hero">
        <div class="bigcover">KOЯD</div>
        <div><small>PLAYLIST</small><h1>Our Playlist</h1><small>KOЯD · ${songs.length} songs</small></div>
      </div>
      <div class="actions">
        <button class="btn primary" onclick="${playing ? "togglePlay()" : "playFrom(cur < 0 ? 0 : cur)"}">${playing ? "❚❚ Pause" : "▶ Play"}</button>
        <button class="btn ghost ${shuffle ? "on" : ""}" onclick="toggleShuffle()">⤮ Shuffle</button>
      </div>` + trackList(all());
  } else if (view.startsWith("pl:") && plById(view.slice(3))) {   // YOUR OWN PLAYLIST page
    const p = plById(view.slice(3)), idxs = plSongs(p);
    html = `<div class="hero">
        ${mosaicOf(idxs, "big")}
        <div><small>PLAYLIST</small><h1>${esc(p.name)}</h1><small>${idxs.length} songs${idxs.length ? " · " + minsOf(idxs) + " min" : ""}</small></div>
      </div>
      <div class="actions">
        ${idxs.length ? `<button class="btn primary" onclick="${playing && idxs.includes(cur) && playingFrom === p.id ? "togglePlay()" : `playPlaylist('${view}')`}">${playing && idxs.includes(cur) && playingFrom === p.id ? "❚❚ Pause" : "▶ Play"}</button>
        <button class="btn ghost ${shuffle ? "on" : ""}" onclick="toggleShuffle()">⤮ Shuffle</button>` : ""}
        <button class="btn ghost" onclick="addSongsDialog('${p.id}')">＋ Add songs</button>
        <button class="btn ghost" onclick="renameDialog('${p.id}')">✎ Rename</button>
        <button class="btn ghost" onclick="deleteDialog('${p.id}')">🗑 Delete</button>
      </div>` + (idxs.length ? trackList(idxs.map(i => ({ s: songs[i], i })), p.id)
        : `<p class="empty-note">This playlist is empty. Press “＋ Add songs” to fill it.</p>`) + `<div class="pad">${saveBar()}</div>`;
  } else if (view === "search") {      // SEARCH page (filters songs as you type)
    const found = all().filter(({ s }) => (s.t + s.a + s.al).toLowerCase().includes(query.toLowerCase()));
    html = `<div class="pad"><input class="search" id="q" placeholder="What do you want to play?">
      ${found.length ? trackList(found) : "<p style='color:var(--muted)'>No results found.</p>"}</div>`;
  } else if (view === "liked") {       // LIKED SONGS page
    const l = all().filter(({ i }) => liked.has(i));
    html = `<div class="pad"><h1>Liked Songs</h1>${l.length ? trackList(l) : "<p style='color:var(--muted)'>Tap ♡ on a song to save it here.</p>"}</div>`;
  } else {                             // YOUR LIBRARY page (list of playlists)
    html = `<div class="pad"><h1>Your Library</h1>
      <button class="libitem" onclick="go('playlist')"><div class="cover" style="background:linear-gradient(135deg,#e5239d,#3a0a2b)"></div><div><b>Nu Metal Essentials</b><small>Playlist · ${songs.length} songs</small></div></button>
      <button class="libitem" onclick="go('liked')"><div class="cover" style="background:linear-gradient(135deg,#7b2ff7,#e5239d)"></div><div><b>Liked Songs</b><small>${liked.size} songs</small></div></button>
      ${playlists.map(p => { const idxs = plSongs(p); return `<button class="libitem" onclick="go('pl:${p.id}')">${idxs.length ? cover(songs[idxs[0]]) : gradCover("#444", "#222")}<div><b>${esc(p.name)}</b><small>Playlist · ${idxs.length} songs</small></div></button>`; }).join("")}
      <button class="btn ghost small" style="margin-top:16px" onclick="newPlaylistDialog()">＋ New playlist</button>
      ${saveBar()}</div>`;
  }
  // ----- Step 2: put it on the page (and stay at the same scroll position) -----
  const scroll = $("main").scrollTop;
  $("main").innerHTML = html;
  $("main").scrollTop = scroll;
  const q = $("q");                    // Search box: refill what you typed and keep the cursor there (render redraws the box)
  if (q) { q.value = query; q.oninput = e => { query = e.target.value; render(); }; q.focus(); q.setSelectionRange(query.length, query.length); }

  // ----- Step 3: sidebar + bottom player bar -----
  renderSidebar();

  // Bottom player bar: song name, heart, and which buttons look "on"
  const s = songs[cur];
  $("now").innerHTML = s
    ? `${cover(s)}<div style="min-width:0"><b>${s.t}</b><small>${s.a}</small></div>
       <button class="heart ${liked.has(cur) ? "on" : ""}" onclick="like(${cur})">${liked.has(cur) ? "♥" : "♡"}</button>`
    : `<small>Pick a song to start</small>`;
  // The small "now playing" card at the bottom of the sidebar
  $("mini").innerHTML = s ? `${cover(s)}<div style="min-width:0"><b>${s.t}</b><small>${s.a}</small></div>${playing ? eq : ""}` : "";
  $("mini").classList.toggle("show", !!s);
  $("pp").textContent = playing ? "❚❚" : "▶";
  $("nv-pp").textContent = playing ? "❚❚" : "▶";
  $("shuf").classList.toggle("on", shuffle);
  $("rep").classList.toggle("on", repeat);
  $("nv-shuf").classList.toggle("on", shuffle);
  $("nv-rep").classList.toggle("on", repeat);
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  updateProgress();
}

/* ======================================================================
   PART 5 - LYRICS (Now Playing pop-up)
   Purpose: shows the song's title and lyrics, lights up the line being sung,
   and scrolls smoothly.
     5A  fill the pop-up        5B  lyric sync (the key part)
     5C  smooth scrolling       5D  open / close
   ====================================================================== */

/* ----- 5A. Fill the pop-up ----- */
// the lyrics of a song (a sample is used if the song has none yet)
const lyricsOf = s => (s.lyrics && s.lyrics.length ? s.lyrics : demoLyrics);

// Puts the current song's picture, title, artist and all its lyric lines into the pop-up.
// Runs when a new song starts.
function renderLyrics() {
  const song = songs[cur];
  $("lyr-art").textContent = song ? "" : "KOЯD";
  $("lyr-art").style.background = song ? bg(song) : "linear-gradient(135deg,#e5239d,#3a0a2b)";   // album picture (or gradient)
  $("lyr-title").textContent = song ? song.t : "KOЯD";
  $("lyr-song-title").textContent = song ? song.t : "Choose a song";
  $("lyr-artist").textContent = song ? song.a : "Play a song to see its lyrics.";
  $("lines").innerHTML = song
    ? lyricsOf(song).map(([t, text], i) => `<p id="L${i}" onclick="jumpToLine(${t})">${text}</p>`).join("")
    : "<p>Play a song to see lyrics.</p>";
  userScrolling = false;
  $("lines").scrollTop = 0;
  lastLine = -2;                       // makes updateLyrics redraw from scratch
  updateLyrics();
}
/* ----- 5B. Lyric sync ----- */

// HOW LYRIC SYNC WORKS (the key idea):
//   Every lyric has a time stamp, like [41.8, "To be forced under"].
//   We check the song's current time and find the LAST line whose time has already passed.
//   That is the line being sung, so we light it up and scroll it to the middle.
// This runs many times a second (called from updateProgress in Part 6).
function updateLyrics() {
  if (cur < 0) { $("peek").innerHTML = "<p>Play a song to see lyrics.</p>"; return; }
  const list = lyricsOf(songs[cur]);
  const time = hasAudio() ? audio.currentTime : pos;   // use the real audio time so the sync is accurate
  let now = -1;                                        // -1 = the song has not reached the first lyric yet
  list.forEach(([t], i) => { if (time >= t) now = i; });
  if (now === lastLine) return;                        // same line as before: nothing to change
  lastLine = now;
  // Page 1 (Now Playing): show the current line and the next two, under the song name
  $("peek").innerHTML = list.slice(Math.max(now, 0), Math.max(now, 0) + 3)
    .map(([, text], i) => `<p class="${i === 0 && now >= 0 ? "now" : ""}">${text}</p>`).join("");
  // Page 2 (Lyrics): light up this line (CSS fades the color) and glide it to the middle
  document.querySelectorAll(".lines p").forEach((p, i) => p.classList.toggle("on", i === now));
  if (!userScrolling) scrollToLine(now, false);
}

/* ----- 5C. Smooth scrolling ----- */

// Scrolls the lyrics so line number `now` is in the middle of the screen (-1 = back to the top).
// instant = true jumps with no animation (used when the pop-up opens).
// The math: line's position - half the box height + half the line height = centered.
function scrollToLine(now, instant) {
  const el = $("L" + now), box = $("lines");
  const top = el ? el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2 : 0;
  box.scrollTo({ top, behavior: instant ? "auto" : "smooth" });
}

// If you scroll the lyrics yourself, auto-follow pauses for 3 seconds, then glides back to the current line.
let userScrolling = false, resumeTimer;
function pauseFollow() {
  userScrolling = true;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { userScrolling = false; scrollToLine(lastLine, false); }, 3000);
}
$("lines").addEventListener("wheel", pauseFollow, { passive: true });
$("lines").addEventListener("touchmove", pauseFollow, { passive: true });

// Clicking a lyric line: jump the song to that time and follow along again
function jumpToLine(t) {
  if (cur < 0) return;
  clearTimeout(resumeTimer); userScrolling = false;
  seek(t);
  scrollToLine(lastLine, false);
}

/* ----- 5D. Open / close the pop-up and switch pages ----- */

// Slides between the two pages: 0 = Now Playing, 1 = Lyrics
function showSlide(i, smooth = true) { $("slides").scrollTo({ left: i * $("slides").clientWidth, behavior: smooth ? "smooth" : "auto" }); }
// Opens the pop-up (CSS makes it slide up). page: 0 = Now Playing, 1 = Lyrics
function openNow(page) {
  $("lyrics").classList.add("open");
  $("lyrics").setAttribute("aria-hidden", "false");
  showSlide(page, false);
  clearTimeout(resumeTimer); userScrolling = false;
  scrollToLine(lastLine, true);        // start on the current line (no jump from the top)
}
// Closes the pop-up (CSS makes it slide down). The music keeps playing.
function closeNow() {
  $("lyrics").classList.remove("open");
  $("lyrics").setAttribute("aria-hidden", "true");
}

/* ======================================================================
   PART 6 - BUTTONS
   Purpose: the progress bar, volume, switching screens, and connecting
   every button to the function it should run.
   ====================================================================== */
// Updates the time numbers and progress bars (bottom bar AND Now Playing page), then the lyrics.
// Runs about 4 times a second while a song plays.
function updateProgress() {
  const d = cur >= 0 ? songs[cur].d : 0;
  $("cur").textContent = fmt(pos);
  $("tot").textContent = fmt(d);
  $("fill").style.width = d ? (pos / d * 100) + "%" : "0";
  $("nv-cur").textContent = fmt(pos);
  $("nv-tot").textContent = fmt(d);
  $("nv-fill").style.width = d ? (pos / d * 100) + "%" : "0";
  updateLyrics();
}
// Heart button: add or remove song i from your liked songs
function like(i) { liked.has(i) ? liked.delete(i) : liked.add(i); render(); }
// Shuffle button: on / off
function toggleShuffle() { shuffle = !shuffle; render(); }
// Switches screens WITHOUT reloading the page: change the view, redraw, fade in.
function go(v) {
  view = v; render();
  const m = $("main");
  m.scrollTop = 0;
  m.classList.remove("fade"); void m.offsetWidth; m.classList.add("fade");   // restart the fade animation
}

// ----- Connecting buttons to functions: "when this is clicked, run that" -----
$("pp").onclick = togglePlay;
$("next").onclick = () => next(false);
$("prev").onclick = prev;
$("shuf").onclick = toggleShuffle;
$("rep").onclick = () => { repeat = !repeat; render(); };
// Click on a progress bar to jump to that spot in the song
function barSeek(bar, e) {
  if (cur < 0) return;
  const r = bar.getBoundingClientRect();
  seek(Math.round((e.clientX - r.left) / r.width * songs[cur].d));
}
$("track").onclick = e => barSeek($("track"), e);
$("nv-track").onclick = e => barSeek($("nv-track"), e);
// ----- Events from the real audio player -----
audio.ontimeupdate = () => { pos = Math.floor(audio.currentTime); updateProgress(); };  // song time changed: move the bar
audio.onerror = () => {                                                                // error: file missing or wrong name (shows a red message)
  if (cur < 0 || !audio.getAttribute("src")) return;
  playing = false; render();
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99;background:#b00020;color:#fff;padding:10px;font:14px Arial";
  d.textContent = "Can’t load “" + songs[cur].src + "”. Check that the file is in the songs folder and the name in songs.js matches.";
  document.body.appendChild(d); setTimeout(() => d.remove(), 8000);
};
audio.onended = () => next(true);                                                      // song finished: play the next one
audio.onloadedmetadata = () => { songs[cur].d = Math.round(audio.duration); updateProgress(); };  // we now know the real song length
$("vol").oninput = e => {                                                              // volume slider moved
  audio.volume = e.target.value / 100;
  e.target.style.setProperty("--v", e.target.value + "%");                             // paints the filled part of the slider
};
audio.volume = 0.7;

// ----- Now Playing / Lyrics pop-up buttons -----
$("lyr-btn").onclick = () => openNow(1);                                   // mic button -> lyrics page
$("now").onclick = e => { if (cur >= 0 && !e.target.closest(".heart")) openNow(0); };   // click the song in the bottom bar
$("lyr-close").onclick = closeNow;
$("tab0").onclick = () => showSlide(0);
$("tab1").onclick = () => showSlide(1);
$("peek").onclick = () => showSlide(1);                                    // tap the small lyrics to see all of them
$("slides").onscroll = () => {                                             // when you swipe between pages, update the tab buttons
  const i = Math.round($("slides").scrollLeft / $("slides").clientWidth);
  $("tab0").classList.toggle("on", i === 0);
  $("tab1").classList.toggle("on", i === 1);
};
$("nv-pp").onclick = togglePlay;
$("nv-shuf").onclick = toggleShuffle;
$("nv-rep").onclick = () => { repeat = !repeat; render(); };
$("pl-new").onclick = () => newPlaylistDialog();
$("mini").onclick = () => { if (cur >= 0) openNow(0); };
$("nv-prev").onclick = prev;
$("nv-next").onclick = () => next(false);
document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => go(b.dataset.view));
// Keyboard: Space = play / pause, Escape = close the pop-up
document.addEventListener("keydown", e => {
  if (e.code === "Escape") closeNow();
  if (e.code === "Space" && !["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)) {
    e.preventDefault(); togglePlay();
  }
});

/* ======================================================================
   PART 7 - START
   The only two things that run by themselves when the page opens.
   ====================================================================== */
loadPlaylists();   // 1. read your saved playlists
render();          // 2. draw the app for the first time
