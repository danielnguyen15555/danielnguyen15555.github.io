/* Extracted inline JavaScript block 1 */
/* Safe fallback: keep the live train board and disruption alerts working if the
   optional local announcements.js audio helper has not been installed. */
if (!window.transitAnnouncements) {
  window.transitAnnouncements = {
    buses: function () {},
    unavailable: function () {},
    beginTrains: function () {},
    train: function () {}
  };
}

/* Extracted inline JavaScript block 2 */
// Bound each request, including response-body reads, so stalled feeds can recover.
async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {cache:"no-store", signal:controller.signal});
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
let busRefreshing = false;
let railRefreshing = false;
const STOP_ID = "490008986E";
const API = `https://api.tfl.gov.uk/StopPoint/${STOP_ID}/Arrivals`;
const REFRESH_MS = 20000;
const arrivalsEl = document.getElementById("arrivals");
const liveText = document.getElementById("liveText");
const dot = document.getElementById("dot");
const updated = document.getElementById("updated");
function dueText(seconds){
  const mins = Math.max(0, Math.round(seconds/60));
  if(seconds <= 30) return "DUE";
  if(mins < 1) return "<1 min";
  return `${mins} min`;
}
function safe(s){return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function render(items){
  const now = Date.now();
  const sorted = items
    .filter(x => x && x.lineName && x.destinationName)
    .sort((a,b)=>(a.timeToStation||0)-(b.timeToStation||0))
    .slice(0,7);
  if(!sorted.length){
    arrivalsEl.innerHTML = '<div class="state">No live buses currently predicted.<br>Checking again shortly.</div>';
    return;
  }
  arrivalsEl.innerHTML = sorted.map(x=>{
    const mins = dueText(Number(x.timeToStation||0));
    const eta = x.expectedArrival ? new Date(x.expectedArrival).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}) : "";
    return `<div class="arrival">
      <div class="route">${safe(x.lineName)}</div>
      <div><div class="destination">${safe(x.destinationName)}</div><div class="via">${safe(x.towards || x.modeName || "London bus service")}</div></div>
      <div class="time">${mins}<small>${eta ? "EXPECTED "+eta : "LIVE PREDICTION"}</small></div>
    </div>`;
  }).join("");
}
async function refresh(){
  if (busRefreshing) return;
  busRefreshing = true;
  try{
    const data = await fetchFeed(API);
    if(!Array.isArray(data)) throw new Error("Unexpected response from TfL");
    render(data);
    window.transitAnnouncements.buses(data);
    updateBusServiceHours(data);
    liveText.textContent = "LIVE";
    dot.style.background = "var(--green)";
    dot.style.boxShadow = "0 0 12px #72d572";
    updated.textContent = "UPDATED "+new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }catch(err){
    window.transitAnnouncements.unavailable("bus");
    liveText.textContent = "DATA UNAVAILABLE";
    dot.style.background = "#e35b50";
    dot.style.boxShadow = "0 0 12px #e35b50";
    arrivalsEl.innerHTML = '<div class="state error">Live arrivals are temporarily unavailable.<br>Reconnecting automatically — predictions resume when the feed returns.</div>';
    updated.textContent = "RETRYING";
  } finally {
    busRefreshing = false;
  }
}
refresh();
setInterval(refresh,REFRESH_MS);

// Look up the timetable's first and last scheduled journeys for each route
// serving this stop. These are scheduled service boundaries, not live vehicles.
const busHoursEl = document.getElementById("busServiceHours");
const busTimetableCache = new Map();

function clockFromTfLJourney(journey) {
  if (!journey) return "";
  const h = Number(journey.hour);
  const m = Number(journey.minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
}
function collectTfLSchedules(value, found=[]) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach(v => collectTfLSchedules(v, found));
    return found;
  }
  if (value.firstJourney || value.lastJourney) found.push(value);
  Object.values(value).forEach(v => {
    if (v && typeof v === "object") collectTfLSchedules(v, found);
  });
  return found;
}
async function getBusHours(lineId) {
  if (busTimetableCache.has(lineId)) return busTimetableCache.get(lineId);
  const promise = (async () => {
    const url = `https://api.tfl.gov.uk/Line/${encodeURIComponent(lineId)}/Timetable/${encodeURIComponent(STOP_ID)}`;
    const data = await fetchFeed(url);
    const schedules = collectTfLSchedules(data);
    const first = schedules.map(s => clockFromTfLJourney(s.firstJourney)).filter(Boolean).sort()[0] || "";
    const last = schedules.map(s => clockFromTfLJourney(s.lastJourney)).filter(Boolean).sort().slice(-1)[0] || "";
    return {first,last};
  })();
  busTimetableCache.set(lineId,promise);
  try { return await promise; }
  catch (error) { busTimetableCache.delete(lineId); throw error; }
}
async function updateBusServiceHours(items) {
  if (!busHoursEl) return;
  const routes = [...new Map((items || []).filter(x => x && (x.lineId || x.lineName))
    .map(x => [String(x.lineId || x.lineName), {id:String(x.lineId || x.lineName),name:String(x.lineName || x.lineId)}])).values()].slice(0,8);
  if (!routes.length) {
    busHoursEl.innerHTML = '<div class="bus-hours-title">BUS SERVICE HOURS</div><div class="bus-hours-state">Route timetable information will appear when arrivals are available.</div>';
    return;
  }
  busHoursEl.innerHTML = '<div class="bus-hours-title">FIRST &amp; LAST SCHEDULED BUSES</div><div class="bus-hours-state">Loading route timetables…</div>';
  const results = await Promise.allSettled(routes.map(async route => ({...route,...await getBusHours(route.id)})));
  const valid = results.filter(r => r.status === "fulfilled" && (r.value.first || r.value.last)).map(r => r.value);
  if (!valid.length) {
    busHoursEl.innerHTML = '<div class="bus-hours-title">FIRST &amp; LAST SCHEDULED BUSES</div><div class="bus-hours-state">TfL timetable times are not available for these routes at this stop. Live arrivals are shown above.</div>';
    return;
  }
  busHoursEl.innerHTML = '<div class="bus-hours-title">FIRST &amp; LAST SCHEDULED BUSES</div><div class="bus-hours-grid">' +
    valid.map(r => `<div class="bus-hours-item"><div class="bus-hours-route">ROUTE ${safe(r.name)}</div><div class="bus-hours-times">FIRST ${safe(r.first || "—")}<br>LAST&nbsp; ${safe(r.last || "—")}</div></div>`).join("") +
    '</div><div class="bus-hours-state" style="margin-top:7px">Scheduled timetable span · may vary by day</div>';
}


// Keep the station board screen awake while the command center is visible.
// Prefer the Screen Wake Lock API; fall back to a tiny muted looping video for
// Amazon Silk / Fire OS and other browsers that lack wakeLock support.
let screenWakeLock = null;
let wakeLockPending = false;
let silkWakeVideo = null;

function ensureSilkWakeVideo() {
  if (silkWakeVideo) return silkWakeVideo;
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  // Hidden muted video from a live canvas stream. Playing media is the usual
  // Silk / Fire OS workaround when navigator.wakeLock is missing.
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 2, 2);
  }
  if (typeof canvas.captureStream !== "function") return null;
  video.srcObject = canvas.captureStream(1);
  Object.assign(video.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    left: "-9999px",
    top: "0",
    opacity: "0",
    pointerEvents: "none"
  });
  document.body.appendChild(video);
  silkWakeVideo = video;
  return video;
}

async function startSilkWakeFallback() {
  if (document.visibilityState !== "visible" ||
      !document.body.classList.contains("dashboard-entered")) return;
  const video = ensureSilkWakeVideo();
  if (!video) return;
  try {
    video.muted = true;
    const play = video.play();
    if (play && typeof play.then === "function") await play;
  } catch (_) {
    // Autoplay policies can still block until the next user gesture.
  }
}

function stopSilkWakeFallback() {
  if (!silkWakeVideo) return;
  try { silkWakeVideo.pause(); } catch (_) {}
}

async function requestScreenWakeLock() {
  if (screenWakeLock || wakeLockPending ||
      document.visibilityState !== "visible" ||
      !document.body.classList.contains("dashboard-entered")) return;
  wakeLockPending = true;
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      screenWakeLock = lock;
      stopSilkWakeFallback();
      lock.addEventListener("release", () => {
        if (screenWakeLock === lock) screenWakeLock = null;
      });
      if (!document.body.classList.contains("dashboard-entered")) await lock.release();
      return;
    }
    await startSilkWakeFallback();
  } catch (_) {
    // Unsupported wakeLock (e.g. Amazon Silk) — use the video fallback.
    await startSilkWakeFallback();
  } finally {
    wakeLockPending = false;
  }
}
function resumeLiveDisplay() {
  if (document.visibilityState !== "visible") return;
  requestScreenWakeLock();
  refresh();
  refreshRail();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") stopSilkWakeFallback();
  resumeLiveDisplay();
});
window.addEventListener("pageshow", resumeLiveDisplay);
window.addEventListener("online", resumeLiveDisplay);
window.addEventListener("announcementsenabled", resumeLiveDisplay);
document.addEventListener("pointerdown", requestScreenWakeLock);
// Retry released locks without accumulating concurrent requests.
setInterval(requestScreenWakeLock, 30000);


// London digital clock: animate every digit that changes.
(function startDigitalClock(){
  const clock = document.getElementById("digitalClock");
  if (!clock) return;
  const digitEls = Array.from(clock.querySelectorAll(".digit"));

  function updateClock(){
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(part => { values[part.type] = part.value; });
    const digits = (values.hour + values.minute + values.second).split("");

    digitEls.forEach((el, index) => {
      if (el.textContent !== digits[index]) {
        el.textContent = digits[index];
        el.classList.remove("flip");
        // Force reflow so the animation can replay on each changed digit.
        void el.offsetWidth;
        el.classList.add("flip");
      }
    });
  }

  updateClock();
  setInterval(updateClock, 250);
})();


// Live South Western Railway departures for Kingston (KNG) and Norbiton (NBT).
// Railinfo documents this public endpoint; no API key is required.
const RAIL_REFRESH_MS = 60000;
const railEl = document.getElementById("railDepartures");
const railLive = document.getElementById("railLive");
const railDot = document.getElementById("railDot");
const railUpdated = document.getElementById("railUpdated");

function railFirst(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

// The board API may wrap its service list in an envelope. Search common
// envelope names and nested objects rather than assuming one exact shape.
function normalizeRailPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const keys = ["departures", "services", "trains", "results", "data", "board", "items"];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = normalizeRailPayload(value);
      if (nested.length) return nested;
    }
  }
  // Some APIs return an object keyed by service ID.
  const values = Object.values(payload);
  if (values.length && values.every(v => v && typeof v === "object" && !Array.isArray(v))) {
    const candidate = values.filter(v =>
      ["destination", "destinationName", "scheduledTime", "std", "expectedTime", "etd"].some(k => k in v)
    );
    if (candidate.length) return candidate;
  }
  return [];
}

function railTime(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") {
    value = railFirst(value, ["time", "scheduled", "expected", "value", "aimed"]);
  }
  const s = String(value);
  const match = s.match(/(?:T|\s|^)(\d{1,2}:\d{2})(?::\d{2})?/);
  if (match) return match[1].padStart(5, "0");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"
  });
}

function railText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(railText).filter(Boolean).join(", ");
  return String(railFirst(value, ["name", "stationName", "locationName", "description", "value"], ""));
}

function railCallingPoints(item) {
  let raw = railFirst(item, [
    "callingPoints", "callingAt", "calls", "stops", "calling_points",
    "subsequentCallingPoints", "route", "via"
  ], []);
  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    raw = railFirst(raw, ["callingPoints", "calls", "stops", "stations"], []);
  }
  if (Array.isArray(raw)) {
    return raw.map(point => {
      if (typeof point === "string") return point;
      return railText(railFirst(point, [
        "stationName", "name", "station", "locationName", "crs"
      ], point));
    }).filter(Boolean);
  }
  return typeof raw === "string" ? raw.split(/\s*(?:>|→|;|\|)\s*/).filter(Boolean) : [];
}

function renderRailStation(stationName, services, crs) {
  const stationCode = crs || (stationName === "Kingston" ? "KNG" : "NBT");
  if (!services.length) {
    return `<section class="led-station" aria-label="${safe(stationName)} departures">
      <header class="led-station-head"><span class="led-station-name">${safe(stationName.toUpperCase())}</span><span class="led-station-code">${stationCode}</span></header>
      <div class="led-empty">NO WATERLOO-BOUND DEPARTURES CURRENTLY LISTED</div>
    </section>`;
  }

  const rows = services.slice(0, 6).map((item, index) => {
    const destination = railText(railFirst(item, [
      "destinationName", "destination", "dest", "towards", "to", "destinationStation"
    ], "London Waterloo")) || "London Waterloo";
    const scheduled = railTime(railFirst(item, [
      "scheduledTime", "scheduledDeparture", "scheduled", "std",
      "aimedDeparture", "originDeparture", "departureTime", "time"
    ]));
    const expectedRaw = railFirst(item, [
      "expectedTime", "expectedDeparture", "expected", "etd",
      "realtime", "estimatedTime", "predictedDeparture", "liveTime"
    ], "");
    const expectedText = railText(expectedRaw) || railTime(expectedRaw);
    const expectedHasValue = expectedRaw !== undefined && expectedRaw !== null && expectedRaw !== "";
    const expected = !expectedHasValue || /on time|ontime/i.test(expectedText)
      ? "On time" : railTime(expectedRaw);
    const platform = railText(railFirst(item, [
      "platform", "platformName", "platformNumber", "platform_number"
    ], "—")) || "—";
    const statusRaw = railText(railFirst(item, [
      "status", "delayReason", "message", "disruption"
    ], ""));
    const cancellationText = railText(railFirst(item, [
      "cancellationReason", "cancelReason", "cancelledReason", "disruptionReason"
    ], ""));
    const statusCombined = [statusRaw, expectedText, cancellationText].join(" ");
    const cancelled = item.cancelled === true || item.isCancelled === true ||
      item.cancellation === true || /cancel|not running/i.test(statusCombined);
    const scheduledMinutes = scheduled.match(/^(\\d{2}):(\\d{2})$/);
    const expectedMinutes = expected.match(/^(\\d{2}):(\\d{2})$/);
    const explicitDelay = item.isDelayed === true || item.delayed === true ||
      /delay|late|mins? late|minutes? late/i.test(statusCombined) ||
      Number(railFirst(item, ["delayMinutes", "delay", "lateBy"], 0)) > 0;
    const delayed = !cancelled && (explicitDelay || (scheduledMinutes && expectedMinutes &&
      (Number(expectedMinutes[1]) * 60 + Number(expectedMinutes[2])) >
      (Number(scheduledMinutes[1]) * 60 + Number(scheduledMinutes[2]))));
    const status = cancelled ? "CANCELLED" : delayed ? "DELAYED" :
      expected === "On time" ? "ON TIME" : (statusRaw || "EXPECTED");
    const calls = railCallingPoints(item);
    const callsText = calls.length ? calls.join("  ·  ") : "Calling points not supplied by live feed";
    window.transitAnnouncements.train({
      station: stationName,
      id: railText(railFirst(item, ["serviceId", "serviceID", "rid", "id"], scheduled + destination)),
      destination, scheduled,
      expected: expectedText ? (/on\\s*time/i.test(expectedText) ? "On time" : railTime(expectedRaw)) : "",
      platform, cancelled, status: statusRaw
    });
    const marquee = calls.length > 4
      ? `<div class="led-marquee"><span>${safe(callsText)}　 ·　 ${safe(callsText)}　 ·　</span></div>`
      : `<div class="led-calling-text">${safe(callsText)}</div>`;
    return `<article class="led-departure">
      <div class="led-main-line">
        <span class="led-time">${safe(scheduled)}</span>
        <span class="led-destination">${safe(destination)}</span>
        <span class="led-status ${cancelled || delayed ? "led-alert" : ""}">${safe(cancelled ? "CANCELLED" : expected)}</span>
      </div>
      <div class="led-detail-line">
        <span class="led-platform">PLAT ${safe(platform)}</span>
        <span class="led-calling-label">CALLING AT:</span>
        ${marquee}
      </div>
    </article>`;
  }).join("");

  return `<section class="led-station" aria-label="${safe(stationName)} departures">
    <header class="led-station-head"><span class="led-station-name">${safe(stationName.toUpperCase())}</span><span class="led-station-code">${stationCode}</span><span class="led-live-indicator">● LIVE</span></header>
    <div class="led-departures">${rows}</div>
  </section>`;
}
async function fetchRailStation(crs) {
  const url = `https://norbiton-train-proxy.danielnguyen15555.workers.dev/?station=${crs}`;
  return normalizeRailPayload(await fetchFeed(url));
}

function isWaterlooService(item) {
  const haystack = [
    railText(railFirst(item, ["destinationName","destination","dest","towards","to","destinationStation"], "")),
    railText(railFirst(item, ["via","routeDescription","callingAt","callingPoints","calls"], "")),
    JSON.stringify(item)
  ].join(" ").toLowerCase();
  return haystack.includes("waterloo");
}

function railDisruptionSummary(services, stationName) {
  return services.map(item => {
    const destination = railText(railFirst(item, [
      "destinationName", "destination", "dest", "towards", "to", "destinationStation"
    ], "London Waterloo")) || "London Waterloo";
    const scheduled = railTime(railFirst(item, [
      "scheduledTime", "scheduledDeparture", "scheduled", "std",
      "aimedDeparture", "originDeparture", "departureTime", "time"
    ]));
    const expectedRaw = railFirst(item, [
      "expectedTime", "expectedDeparture", "expected", "etd",
      "realtime", "estimatedTime", "predictedDeparture", "liveTime"
    ], "");
    const expectedText = railText(expectedRaw) || railTime(expectedRaw);
    const expectedHasValue = expectedRaw !== undefined && expectedRaw !== null && expectedRaw !== "";
    const expected = !expectedHasValue || /on time|ontime/i.test(expectedText) ? "On time" : railTime(expectedRaw);
    const statusRaw = railText(railFirst(item, ["status", "delayReason", "message", "disruption"], ""));
    const cancellationText = railText(railFirst(item, [
      "cancellationReason", "cancelReason", "cancelledReason", "disruptionReason"
    ], ""));
    const combined = [statusRaw, expectedText, cancellationText].join(" ");
    const cancelled = item.cancelled === true || item.isCancelled === true ||
      item.cancellation === true || /cancel|not running/i.test(combined);
    const sm = scheduled.match(/^(\d{2}):(\d{2})$/);
    const em = expected.match(/^(\d{2}):(\d{2})$/);
    const explicitDelay = item.isDelayed === true || item.delayed === true ||
      /delay|late|mins? late|minutes? late/i.test(combined) ||
      Number(railFirst(item, ["delayMinutes", "delay", "lateBy"], 0)) > 0;
    const delayed = !cancelled && (explicitDelay || (sm && em &&
      ((Number(em[1]) * 60 + Number(em[2])) - (Number(sm[1]) * 60 + Number(sm[2])) + 1440) % 1440 > 0));
    if (!cancelled && !delayed) return null;
    return { stationName, destination, scheduled, status: cancelled ? "CANCELLED" : "DELAYED" };
  }).filter(Boolean);
}

function updateSWRServiceStatus(feedOk, totalServices, disruptions) {
  const box = document.getElementById("swrServiceStatus");
  const title = document.getElementById("swrStatusTitle");
  const detail = document.getElementById("swrStatusDetail");
  const symbol = box && box.querySelector(".swr-status-symbol");
  if (!box || !title || !detail || !symbol) return;

  box.classList.remove("status-checking", "status-good", "status-minor", "status-disrupted", "status-unknown");
  if (!feedOk || totalServices === 0) {
    box.classList.add("status-unknown");
    title.textContent = "SERVICE STATUS UNAVAILABLE";
    detail.textContent = !feedOk
      ? "Live departure feed unavailable — this is not confirmation of good service."
      : "No Waterloo-bound services are currently listed for these stations.";
    symbol.textContent = "!";
    return;
  }

  const cancelledCount = disruptions.filter(x => x.status === "CANCELLED").length;
  const delayedCount = disruptions.filter(x => x.status === "DELAYED").length;
  if (cancelledCount > 0 || disruptions.length >= 3) {
    box.classList.add("status-disrupted");
    title.textContent = "SERVICE DISRUPTED";
    detail.textContent = `${cancelledCount} cancelled · ${delayedCount} delayed in the Kingston and Norbiton departure feeds.`;
    symbol.textContent = "!";
  } else if (delayedCount > 0) {
    box.classList.add("status-minor");
    title.textContent = "MINOR DELAYS";
    detail.textContent = `${delayedCount} delayed service${delayedCount === 1 ? "" : "s"} reported across Kingston and Norbiton.`;
    symbol.textContent = "!";
  } else {
    box.classList.add("status-good");
    title.textContent = "GOOD SERVICE";
    detail.textContent = `No delays or cancellations detected in the live Waterloo-bound departures at Kingston and Norbiton.`;
    symbol.textContent = "✓";
  }
}

async function refreshRail() {
  if (railRefreshing) return;
  railRefreshing = true;
  try {
  const results = await Promise.allSettled([
    fetchRailStation("KNG"),
    fetchRailStation("NBT")
  ]);

  window.transitAnnouncements.beginTrains();
  const sections = [];
  const disruptionAlerts = [];
  let totalServicesSeen = 0;
  let successes = 0;
  const stationNames = ["Kingston", "Norbiton"];

  results.forEach((result, index) => {
    const name = stationNames[index];
    if (result.status === "fulfilled") {
      successes++;
      const allWaterlooServices = result.value.filter(isWaterlooService);
      const services = allWaterlooServices.slice(0, 8);
      totalServicesSeen += allWaterlooServices.length;
      disruptionAlerts.push(...railDisruptionSummary(allWaterlooServices, name));
      sections.push(renderRailStation(name, services, index === 0 ? "KNG" : "NBT"));
    } else {
      sections.push(`<div class="station-block">
        <div class="station-heading"><span>${name.toUpperCase()}</span><span>WATERLOO SERVICES</span></div>
        <div class="rail-state">Live departures temporarily unavailable (${safe(result.reason?.message || "feed error")}).</div>
      </div>`);
    }
  });

  railEl.innerHTML = sections.join("");
  updateSWRServiceStatus(results.every(result => result.status === "fulfilled"),
    totalServicesSeen, disruptionAlerts);

  const railAlert = document.getElementById("railAlert");
  const totalWaterlooServices = results.reduce((sum, result) =>
    sum + (result.status === "fulfilled" ? result.value.filter(isWaterlooService).length : 0), 0);
  const bothFeedsOk = results.every(result => result.status === "fulfilled");
  if (railAlert) {
    if (bothFeedsOk && totalWaterlooServices === 0) {
      railAlert.hidden = false;
      railAlert.classList.add("orange");
      railAlert.innerHTML = '⚠ NO TRAIN INFORMATION — CHECK SERVICE<small>No Waterloo-bound trains are currently appearing for Kingston or Norbiton. This may indicate a cancellation, disruption or a break in service. The live board cannot confirm the cause — check SWR or National Rail before travelling.</small>';
    } else if (!bothFeedsOk) {
      railAlert.hidden = false;
      railAlert.classList.add("orange");
      railAlert.innerHTML = '⚠ TRAIN INFORMATION LOST — CHECK SERVICE<small>The live departure feed is unavailable, so cancellations or a service suspension cannot be ruled out. Check SWR or National Rail for confirmed information.</small>';
    } else if (disruptionAlerts.length) {
      railAlert.hidden = false;
      railAlert.classList.remove("orange");
      const lines = disruptionAlerts.map(x =>
        `${safe(x.stationName)} · ${safe(x.scheduled)} · ${safe(x.destination)} — ${safe(x.status)}`
      ).join("<br>");
      railAlert.innerHTML = `⚠ SWR SERVICE DISRUPTION — ${disruptionAlerts.length} ALERT${disruptionAlerts.length === 1 ? "" : "S"}<small>${lines}<br>Live feed reports a delay or cancellation. Check SWR or National Rail for the latest details.</small>`;
    } else {
      railAlert.hidden = true;
      railAlert.textContent = "";
      railAlert.classList.remove("orange");
    }
  }

  railLive.textContent = successes === 2 ? "LIVE" : successes === 1 ? "PARTIAL" : "OFFLINE";
  railDot.style.background = successes ? "var(--green)" : "#e35b50";
  railDot.style.boxShadow = successes ? "0 0 12px #72d572" : "0 0 12px #e35b50";
  railUpdated.textContent = (successes ? "UPDATED " : "RETRYING · ") + new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  } finally {
    railRefreshing = false;
  }
}

refreshRail();
setInterval(refreshRail, RAIL_REFRESH_MS);


// Echo Show 8 hands-free tour: smoothly scroll DOWN and UP, with a visible timer.
(function startAutomaticScroll(){
  const SPEED = 24;               // pixels per second
  const END_PAUSE_MS = 6500;      // dwell at top and bottom
  const MANUAL_PAUSE_MS = 20000;  // pause after touch/remote interaction
  let direction = 1;
  let lastFrame = 0;
  let pausedUntil = 0;
  let animationFrame = 0;
  let userPaused = false;
  let segmentStarted = Date.now();
  let segmentDuration = 0;

  const directionEl = document.getElementById("echoTourDirection");
  const timerEl = document.getElementById("echoTourTimer");
  const toggle = document.getElementById("echoTourToggle");

  function maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }
  function fmt(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(seconds / 60)).padStart(2,"0") + ":" +
           String(seconds % 60).padStart(2,"0");
  }
  function updateHud() {
    const remaining = userPaused ? 0 : Math.max(0, segmentDuration - (Date.now() - segmentStarted));
    if (directionEl) directionEl.textContent = userPaused ? "PAUSED" : (direction > 0 ? "SCROLL DOWN" : "SCROLL UP");
    if (timerEl) timerEl.textContent = userPaused ? "— —" : fmt(remaining);
    if (toggle) toggle.textContent = userPaused ? "RESUME" : "PAUSE";
  }
  function startSegment() {
    segmentStarted = Date.now();
    segmentDuration = Math.max(1000, (maxScroll() / SPEED) * 1000 + END_PAUSE_MS);
    updateHud();
  }
  function pauseForManualUse() {
    if (userPaused) return;
    pausedUntil = Date.now() + MANUAL_PAUSE_MS;
    updateHud();
  }

  ["wheel", "touchstart", "pointerdown", "keydown"].forEach(eventName => {
    window.addEventListener(eventName, pauseForManualUse, {passive:true});
  });

  if (toggle) toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    userPaused = !userPaused;
    if (userPaused) {
      pausedUntil = Number.MAX_SAFE_INTEGER;
    } else {
      pausedUntil = 0;
      lastFrame = 0;
      startSegment();
    }
    updateHud();
  });

  function step(timestamp) {
    if (!lastFrame) lastFrame = timestamp;
    const elapsed = Math.min((timestamp - lastFrame) / 1000, 0.05);
    lastFrame = timestamp;

    const limit = maxScroll();
    if (limit > 8 && !userPaused && document.body.classList.contains("dashboard-entered")) {
      if (Date.now() >= pausedUntil) {
        const current = window.scrollY;
        if (direction > 0 && current >= limit - 2) {
          direction = -1;
          pausedUntil = Date.now() + END_PAUSE_MS;
          startSegment();
        } else if (direction < 0 && current <= 2) {
          direction = 1;
          pausedUntil = Date.now() + END_PAUSE_MS;
          startSegment();
        } else {
          window.scrollTo(0, Math.max(0, Math.min(limit, current + direction * SPEED * elapsed)));
        }
      }
    }
    if (!userPaused && Date.now() >= pausedUntil && segmentDuration === 0) startSegment();
    updateHud();
    animationFrame = requestAnimationFrame(step);
  }

  window.addEventListener("load", () => {
    cancelAnimationFrame(animationFrame);
    lastFrame = 0;
    startSegment();
    animationFrame = requestAnimationFrame(step);
  });
  window.addEventListener("resize", startSegment);
  startSegment();
  animationFrame = requestAnimationFrame(step);
})();





// London time-of-day greeting, updated automatically.
(function updateTimeGreeting(){
  const greetingEl = document.getElementById("timeGreeting");
  if (!greetingEl) return;
  function update(){
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone:"Europe/London", hour:"2-digit", hourCycle:"h23"
    }).format(new Date()));
    const greeting = hour >= 5 && hour < 12 ? "GOOD MORNING" :
      hour >= 12 && hour < 18 ? "GOOD AFTERNOON" : "GOOD NIGHT";
    greetingEl.textContent = greeting;
  }
  update();
  setInterval(update, 60000);
})();


// Welcome settings remain available without adding controls to the departures display.
(function(){
 const settings=document.getElementById('announcementSettings');
 const open=document.getElementById('openSettings');
 open.addEventListener('click',()=>settings.showModal());
 function closeSettings(){settings.close();open.focus();}
 document.getElementById('closeSettings').addEventListener('click',closeSettings);
 settings.addEventListener('close',()=>settings.querySelectorAll('audio').forEach(audio=>audio.pause()));
 document.getElementById('showDashboard').addEventListener('click',()=>{
   settings.close();
   document.body.classList.remove('intro-active');
   document.body.classList.add('dashboard-entered');
   document.querySelector('.sign').inert=false;
   window.scrollTo(0,0);
   document.getElementById('backToWelcome').focus();
   requestScreenWakeLock();
   resumeLiveDisplay();
 });
 document.getElementById('backToWelcome').addEventListener('click',()=>{
   document.body.classList.remove('dashboard-entered');
   document.body.classList.add('intro-active');
   document.querySelector('.sign').inert=true;
   stopSilkWakeFallback();
   if (screenWakeLock) {
     screenWakeLock.release().catch(()=>{});
     screenWakeLock = null;
   }
   document.getElementById('showDashboard').focus();
 });
 document.querySelector('.sign').inert=true;
})();

// Bug reports open a pre-addressed email draft. The visitor reviews and sends it.
(function(){
  const modal=document.getElementById("bugModal");
  const open=document.getElementById("openBugReport");
  const close=document.getElementById("closeBugReport");
  const cancel=document.getElementById("cancelBugReport");
  const send=document.getElementById("sendBugReport");
  const field=document.getElementById("bugDescription");
  if(!modal||!open||!close||!cancel||!send||!field)return;
  function show(){
    if(open.classList.contains("is-loading"))return;
    open.classList.add("is-loading");
    open.disabled=true;
    open.innerHTML='<span class="bug-loading-ring"></span><span>'+(window.dashboardText?window.dashboardText("scanning"):"SCANNING SYSTEM…")+'</span>';
    document.body.classList.add("bug-scan-active");
    window.setTimeout(()=>{
      document.body.classList.remove("bug-scan-active");
      modal.classList.add("open");
      modal.setAttribute("aria-hidden","false");
      open.classList.remove("is-loading");
      open.disabled=false;
      open.innerHTML='<span class="bug-icon">⚑</span><span>FIX BUG</span>';
      setTimeout(()=>field.focus(),80);
    },1450);
  }
  function hide(){modal.classList.remove("open");modal.setAttribute("aria-hidden","true")}
  open.addEventListener("click",show);
  close.addEventListener("click",hide);
  cancel.addEventListener("click",hide);
  modal.addEventListener("click",e=>{if(e.target===modal)hide()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))hide()});
  send.addEventListener("click",()=>{
    const description=field.value.trim();
    if(!description){field.focus();field.placeholder="Please describe the problem before sending.";return}
    const subject=encodeURIComponent("Latchmere Lane dashboard bug report");
    const body=encodeURIComponent(
      "Bug report for the Latchmere Lane dashboard\n\n"+
      "Description:\n"+description+"\n\n"+
      "Reported: "+new Date().toLocaleString("en-GB",{timeZone:"Europe/London"})+"\n"+
      "Page: "+location.href+"\n"+
      "Device/browser: "+navigator.userAgent
    );
    window.location.href="mailto:danielnguyen15555@gmail.com?subject="+subject+"&body="+body;
    hide();
  });
})();


// Multilingual UI. Live station, route and destination names remain in their official feed language.
(function(){
 const translations={
 en:{welcome:"WELCOME",journey:"YOUR JOURNEY STARTS HERE",subtitle:"LATCHMERE LANE · LIVE DEPARTURES",show:"SHOW",fixBug:"FIX BUG",language:"LANGUAGE",hint:"ENTER THE TRANSIT COMMAND CENTRE OR REPORT A PROBLEM",chooseLanguage:"CHOOSE YOUR LANGUAGE",languageHint:"The dashboard interface will change to your selected language.",back:"BACK",live:"LIVE",connecting:"CONNECTING",offline:"OFFLINE",partial:"PARTIAL",brand:"LIVE BUS DEPARTURES",clock:"LONDON TIME",morning:"GOOD MORNING",afternoon:"GOOD AFTERNOON",night:"GOOD NIGHT",ticker1:"CITY TRANSIT NETWORK",ticker2:"LIVE DEPARTURE INTELLIGENCE",ticker3:"LATCHMERE LANE · WESTBOUND",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"REAL-TIME FEEDS · AUTO REFRESH",direction:"WESTBOUND",stop:"BUS STOP",line:"LINE",destination:"DESTINATION",due:"DUE",hours:"SERVICE HOURS",busFetch:"Fetching live arrivals…",noBus:"No live buses currently predicted.<br>Checking again shortly.",busUnavailable:"Unable to load live arrivals.",updated:"UPDATED",retrying:"RETRYING",busData:"Predictions provided by",railTitle:"TRAIN DEPARTURES",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"FIRST & LAST TRAINS TO WATERLOO",time:"TIME",destinationService:"DESTINATION / SERVICE",expected:"EXPECTED",platform:"PLAT.",status:"STATUS",first:"FIRST",last:"LAST",satFirst:"SAT FIRST",satLast:"SAT LAST",sunFirst:"SUN FIRST",sunLast:"SUN LAST",weekdays:"Weekdays",railLoading:"Loading Kingston and Norbiton train departures…",waterlooServices:"WATERLOO SERVICES",noTrains:"No Waterloo-bound trains are currently listed in this station feed.",scheduled:"SCHEDULED",onTime:"On time",cancelled:"CANCELLED",delayed:"DELAYED",callingAt:"CALLING AT",railLost:"⚠ TRAIN INFORMATION LOST — POSSIBLE SERVICE DISRUPTION",noTrainInfo:"⚠ NO TRAIN INFORMATION — POSSIBLE CANCELLATION OR SERVICE SUSPENSION",railData:"Rail data:",feedback:"SYSTEM FEEDBACK",foundBug:"FOUND A BUG?",bugExplain:"Tell Dan and Kev what went wrong. Your email app will open with the report ready to send.",whatHappened:"WHAT HAPPENED?",describe:"Describe the problem…",cancel:"CANCEL",send:"SEND REPORT",sendTo:"REPORTS ARE ADDRESSED TO",scanning:"SCANNING SYSTEM…",boot1:"INITIALISING TRANSIT NETWORK",boot2:"CONNECTING TO LIVE DEPARTURES",boot3:"CALIBRATING LATCHMERE DISPLAY",bootGo:"WELCOME TO THE COMMAND CENTRE"},
 vi:{welcome:"CHÀO MỪNG",journey:"HÀNH TRÌNH CỦA BẠN BẮT ĐẦU TẠI ĐÂY",subtitle:"LATCHMERE LANE · GIỜ XE CHẠY",show:"HIỂN THỊ",fixBug:"BÁO LỖI",language:"NGÔN NGỮ",hint:"VÀO TRUNG TÂM ĐIỀU HÀNH HOẶC BÁO SỰ CỐ",chooseLanguage:"CHỌN NGÔN NGỮ",languageHint:"Giao diện bảng thông tin sẽ chuyển sang ngôn ngữ bạn chọn.",back:"QUAY LẠI",live:"TRỰC TIẾP",connecting:"ĐANG KẾT NỐI",offline:"NGOẠI TUYẾN",partial:"MỘT PHẦN",brand:"GIỜ XE BUÝT TRỰC TIẾP",clock:"GIỜ LONDON",morning:"CHÀO BUỔI SÁNG",afternoon:"CHÀO BUỔI CHIỀU",night:"CHÚC BUỔI TỐI",ticker1:"MẠNG LƯỚI GIAO THÔNG THÀNH PHỐ",ticker2:"THÔNG TIN KHỞI HÀNH TRỰC TIẾP",ticker3:"LATCHMERE LANE · HƯỚNG TÂY",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"DỮ LIỆU TRỰC TIẾP · TỰ ĐỘNG LÀM MỚI",direction:"HƯỚNG TÂY",stop:"ĐIỂM DỪNG XE BUÝT",line:"TUYẾN",destination:"ĐIỂM ĐẾN",due:"CÒN",hours:"GIỜ HOẠT ĐỘNG",busFetch:"Đang tải dữ liệu xe buýt…",noBus:"Hiện chưa có dự báo xe buýt.<br>Sẽ kiểm tra lại ngay.",busUnavailable:"Không thể tải dữ liệu xe buýt.",updated:"CẬP NHẬT",retrying:"ĐANG THỬ LẠI",busData:"Dự báo từ",railTitle:"GIỜ TÀU CHẠY",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"CHUYẾN TÀU ĐẦU VÀ CUỐI ĐẾN WATERLOO",time:"GIỜ",destinationService:"ĐIỂM ĐẾN / DỊCH VỤ",expected:"DỰ KIẾN",platform:"SÂN GA",status:"TRẠNG THÁI",first:"ĐẦU",last:"CUỐI",satFirst:"THỨ BẢY ĐẦU",satLast:"THỨ BẢY CUỐI",sunFirst:"CHỦ NHẬT ĐẦU",sunLast:"CHỦ NHẬT CUỐI",weekdays:"Ngày thường",railLoading:"Đang tải giờ tàu Kingston và Norbiton…",waterlooServices:"TÀU ĐẾN WATERLOO",noTrains:"Hiện không có chuyến tàu đến Waterloo trong dữ liệu nhà ga này.",scheduled:"THEO LỊCH",onTime:"Đúng giờ",cancelled:"ĐÃ HỦY",delayed:"TRỄ",callingAt:"DỪNG TẠI",railLost:"⚠ MẤT THÔNG TIN TÀU — CÓ THỂ GIÁN ĐOẠN DỊCH VỤ",noTrainInfo:"⚠ KHÔNG CÓ THÔNG TIN TÀU — CÓ THỂ HỦY CHUYẾN",railData:"Dữ liệu tàu:",feedback:"PHẢN HỒI HỆ THỐNG",foundBug:"PHÁT HIỆN LỖI?",bugExplain:"Hãy cho Dan và Kev biết vấn đề. Ứng dụng email sẽ mở với báo cáo đã soạn sẵn.",whatHappened:"ĐIỀU GÌ ĐÃ XẢY RA?",describe:"Mô tả sự cố…",cancel:"HỦY",send:"GỬI BÁO CÁO",sendTo:"BÁO CÁO ĐƯỢC GỬI ĐẾN",scanning:"ĐANG QUÉT HỆ THỐNG…",boot1:"ĐANG KHỞI TẠO MẠNG LƯỚI GIAO THÔNG",boot2:"ĐANG KẾT NỐI GIỜ KHỞI HÀNH",boot3:"ĐANG HIỆU CHỈNH BẢNG LATCHMERE",bootGo:"CHÀO MỪNG ĐẾN TRUNG TÂM ĐIỀU HÀNH"},
 fr:{welcome:"BIENVENUE",journey:"VOTRE VOYAGE COMMENCE ICI",subtitle:"LATCHMERE LANE · DÉPARTS EN DIRECT",show:"AFFICHER",fixBug:"SIGNALER UN BUG",language:"LANGUE",hint:"ACCÉDER AU CENTRE DE TRANSPORT OU SIGNALER UN PROBLÈME",chooseLanguage:"CHOISISSEZ VOTRE LANGUE",languageHint:"L’interface du tableau sera traduite dans la langue choisie.",back:"RETOUR",live:"EN DIRECT",connecting:"CONNEXION",offline:"HORS LIGNE",partial:"PARTIEL",brand:"DÉPARTS DE BUS EN DIRECT",clock:"HEURE DE LONDRES",morning:"BONJOUR",afternoon:"BON APRÈS-MIDI",night:"BONNE SOIRÉE",ticker1:"RÉSEAU DE TRANSPORT URBAIN",ticker2:"INFORMATIONS DE DÉPART EN DIRECT",ticker3:"LATCHMERE LANE · DIRECTION OUEST",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"FLUX EN DIRECT · ACTUALISATION AUTO",direction:"DIRECTION OUEST",stop:"ARRÊT DE BUS",line:"LIGNE",destination:"DESTINATION",due:"DANS",hours:"HORAIRES DE SERVICE",busFetch:"Chargement des arrivées…",noBus:"Aucun bus prévu pour le moment.<br>Nouvelle vérification bientôt.",busUnavailable:"Impossible de charger les arrivées.",updated:"MIS À JOUR",retrying:"NOUVEL ESSAI",busData:"Prévisions fournies par",railTitle:"DÉPARTS DES TRAINS",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"PREMIER ET DERNIER TRAINS POUR WATERLOO",time:"HEURE",destinationService:"DESTINATION / SERVICE",expected:"PRÉVU",platform:"VOIE",status:"STATUT",first:"PREMIER",last:"DERNIER",satFirst:"SAM. PREMIER",satLast:"SAM. DERNIER",sunFirst:"DIM. PREMIER",sunLast:"DIM. DERNIER",weekdays:"En semaine",railLoading:"Chargement des trains de Kingston et Norbiton…",waterlooServices:"TRAINS POUR WATERLOO",noTrains:"Aucun train vers Waterloo n’est actuellement indiqué.",scheduled:"PRÉVU",onTime:"À l’heure",cancelled:"ANNULÉ",delayed:"EN RETARD",callingAt:"DESSERT",railLost:"⚠ INFORMATIONS TRAINS INDISPONIBLES — PERTURBATION POSSIBLE",noTrainInfo:"⚠ AUCUNE INFORMATION TRAIN — ANNULATION POSSIBLE",railData:"Données ferroviaires :",feedback:"COMMENTAIRES SYSTÈME",foundBug:"UN BUG ?",bugExplain:"Expliquez le problème à Dan et Kev. Votre application e-mail s’ouvrira avec le rapport prêt à envoyer.",whatHappened:"QUE S’EST-IL PASSÉ ?",describe:"Décrivez le problème…",cancel:"ANNULER",send:"ENVOYER LE RAPPORT",sendTo:"RAPPORTS ENVOYÉS À",scanning:"ANALYSE DU SYSTÈME…",boot1:"INITIALISATION DU RÉSEAU",boot2:"CONNEXION AUX DÉPARTS EN DIRECT",boot3:"CALIBRAGE DE L’AFFICHAGE",bootGo:"BIENVENUE AU CENTRE DE CONTRÔLE"},
 es:{welcome:"BIENVENIDO",journey:"TU VIAJE EMPIEZA AQUÍ",subtitle:"LATCHMERE LANE · SALIDAS EN DIRECTO",show:"MOSTRAR",fixBug:"NOTIFICAR ERROR",language:"IDIOMA",hint:"ENTRA EN EL CENTRO DE TRANSPORTE O INFORMA DE UN PROBLEMA",chooseLanguage:"ELIGE TU IDIOMA",languageHint:"La interfaz del panel cambiará al idioma seleccionado.",back:"VOLVER",live:"EN DIRECTO",connecting:"CONECTANDO",offline:"SIN CONEXIÓN",partial:"PARCIAL",brand:"SALIDAS DE AUTOBÚS EN DIRECTO",clock:"HORA DE LONDRES",morning:"BUENOS DÍAS",afternoon:"BUENAS TARDES",night:"BUENAS NOCHES",ticker1:"RED DE TRANSPORTE URBANO",ticker2:"INFORMACIÓN DE SALIDAS EN DIRECTO",ticker3:"LATCHMERE LANE · DIRECCIÓN OESTE",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"DATOS EN DIRECTO · ACTUALIZACIÓN AUTOMÁTICA",direction:"DIRECCIÓN OESTE",stop:"PARADA DE AUTOBÚS",line:"LÍNEA",destination:"DESTINO",due:"EN",hours:"HORARIOS DE SERVICIO",busFetch:"Cargando llegadas…",noBus:"No hay autobuses previstos ahora.<br>Volviendo a comprobar pronto.",busUnavailable:"No se pueden cargar las llegadas.",updated:"ACTUALIZADO",retrying:"REINTENTANDO",busData:"Predicciones de",railTitle:"SALIDAS DE TRENES",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"PRIMER Y ÚLTIMO TREN A WATERLOO",time:"HORA",destinationService:"DESTINO / SERVICIO",expected:"PREVISTO",platform:"ANDÉN",status:"ESTADO",first:"PRIMERO",last:"ÚLTIMO",satFirst:"SÁB. PRIMERO",satLast:"SÁB. ÚLTIMO",sunFirst:"DOM. PRIMERO",sunLast:"DOM. ÚLTIMO",weekdays:"Días laborables",railLoading:"Cargando trenes de Kingston y Norbiton…",waterlooServices:"TRENES A WATERLOO",noTrains:"No hay trenes a Waterloo indicados actualmente.",scheduled:"PROGRAMADO",onTime:"A tiempo",cancelled:"CANCELADO",delayed:"RETRASADO",callingAt:"PARADAS",railLost:"⚠ INFORMACIÓN DE TRENES PERDIDA — POSIBLE INTERRUPCIÓN",noTrainInfo:"⚠ SIN INFORMACIÓN DE TRENES — POSIBLES CANCELACIONES",railData:"Datos ferroviarios:",feedback:"COMENTARIOS DEL SISTEMA",foundBug:"¿HAS ENCONTRADO UN ERROR?",bugExplain:"Cuéntales a Dan y Kev qué ha ocurrido. Se abrirá tu aplicación de correo con el informe preparado.",whatHappened:"¿QUÉ HA OCURRIDO?",describe:"Describe el problema…",cancel:"CANCELAR",send:"ENVIAR INFORME",sendTo:"INFORMES DIRIGIDOS A",scanning:"ANALIZANDO SISTEMA…",boot1:"INICIANDO RED DE TRANSPORTE",boot2:"CONECTANDO CON SALIDAS EN DIRECTO",boot3:"CALIBRANDO PANEL LATCHMERE",bootGo:"BIENVENIDO AL CENTRO DE CONTROL"},
 de:{welcome:"WILLKOMMEN",journey:"IHRE REISE BEGINNT HIER",subtitle:"LATCHMERE LANE · LIVE-ABFAHRTEN",show:"ANZEIGEN",fixBug:"FEHLER MELDEN",language:"SPRACHE",hint:"ZUR VERKEHRSZENTRALE ODER EIN PROBLEM MELDEN",chooseLanguage:"SPRACHE AUSWÄHLEN",languageHint:"Die Dashboard-Oberfläche wird in die gewählte Sprache übersetzt.",back:"ZURÜCK",live:"LIVE",connecting:"VERBINDUNG",offline:"OFFLINE",partial:"TEILWEISE",brand:"LIVE-BUSABFAHRTEN",clock:"LONDONER ZEIT",morning:"GUTEN MORGEN",afternoon:"GUTEN TAG",night:"GUTE NACHT",ticker1:"STÄDTISCHES VERKEHRSNETZ",ticker2:"LIVE-ABFAHRTSINFORMATIONEN",ticker3:"LATCHMERE LANE · WESTWÄRTS",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"LIVE-DATEN · AUTOMATISCHE AKTUALISIERUNG",direction:"WESTWÄRTS",stop:"BUSHALTESTELLE",line:"LINIE",destination:"ZIEL",due:"IN",hours:"BETRIEBSZEITEN",busFetch:"Live-Ankünfte werden geladen…",noBus:"Derzeit keine Busse vorhergesagt.<br>Es wird bald erneut geprüft.",busUnavailable:"Live-Ankünfte konnten nicht geladen werden.",updated:"AKTUALISIERT",retrying:"NEUER VERSUCH",busData:"Prognosen von",railTitle:"ZUGABFAHRTEN",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"ERSTER UND LETZTER ZUG NACH WATERLOO",time:"ZEIT",destinationService:"ZIEL / SERVICE",expected:"ERWARTET",platform:"GLEIS",status:"STATUS",first:"ERSTER",last:"LETZTER",satFirst:"SA ERSTER",satLast:"SA LETZTER",sunFirst:"SO ERSTER",sunLast:"SO LETZTER",weekdays:"Werktags",railLoading:"Zugabfahrten werden geladen…",waterlooServices:"ZÜGE NACH WATERLOO",noTrains:"In diesem Stationsfeed sind derzeit keine Züge nach Waterloo aufgeführt.",scheduled:"GEPLANT",onTime:"Pünktlich",cancelled:"AUSGEFALLEN",delayed:"VERSPÄTET",callingAt:"HALT IN",railLost:"⚠ ZUGINFORMATIONEN FEHLEN — MÖGLICHE STÖRUNG",noTrainInfo:"⚠ KEINE ZUGINFORMATIONEN — MÖGLICHE AUSFÄLLE",railData:"Bahndaten:",feedback:"SYSTEMRÜCKMELDUNG",foundBug:"FEHLER GEFUNDEN?",bugExplain:"Teilen Sie Dan und Kev mit, was nicht funktioniert. Ihre E-Mail-App öffnet einen vorbereiteten Bericht.",whatHappened:"WAS IST PASSIERT?",describe:"Problem beschreiben…",cancel:"ABBRECHEN",send:"BERICHT SENDEN",sendTo:"BERICHTE AN",scanning:"SYSTEM WIRD GEPRÜFT…",boot1:"VERKEHRSNETZ WIRD INITIALISIERT",boot2:"LIVE-ABFAHRTEN WERDEN VERBUNDEN",boot3:"LATCHMERE-ANZEIGE WIRD KALIBRIERT",bootGo:"WILLKOMMEN IN DER VERKEHRSZENTRALE"},
 pl:{welcome:"WITAMY",journey:"TWOJA PODRÓŻ ZACZYNA SIĘ TUTAJ",subtitle:"LATCHMERE LANE · ODJAZDY NA ŻYWO",show:"POKAŻ",fixBug:"ZGŁOŚ BŁĄD",language:"JĘZYK",hint:"WEJDŹ DO CENTRUM TRANSPORTU LUB ZGŁOŚ PROBLEM",chooseLanguage:"WYBIERZ JĘZYK",languageHint:"Interfejs tablicy zostanie zmieniony na wybrany język.",back:"WRÓĆ",live:"NA ŻYWO",connecting:"ŁĄCZENIE",offline:"BRAK POŁĄCZENIA",partial:"CZĘŚCIOWO",brand:"ODJAZDY AUTOBUSÓW NA ŻYWO",clock:"CZAS LONDYŃSKI",morning:"DZIEŃ DOBRY",afternoon:"DOBRE POPOŁUDNIE",night:"DOBRANOC",ticker1:"MIEJSKA SIEĆ TRANSPORTOWA",ticker2:"INFORMACJE O ODJAZDACH NA ŻYWO",ticker3:"LATCHMERE LANE · KIERUNEK ZACHODNI",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"DANE NA ŻYWO · AUTOAKTUALIZACJA",direction:"KIERUNEK ZACHODNI",stop:"PRZYSTANEK AUTOBUSOWY",line:"LINIA",destination:"CEL",due:"ZA",hours:"GODZINY KURSOWANIA",busFetch:"Pobieranie odjazdów autobusów…",noBus:"Brak przewidywanych autobusów.<br>Sprawdzimy ponownie wkrótce.",busUnavailable:"Nie można pobrać odjazdów.",updated:"AKTUALIZACJA",retrying:"PONAWIANIE",busData:"Prognozy dostarcza",railTitle:"ODJAZDY POCIĄGÓW",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"PIERWSZY I OSTATNI POCIĄG DO WATERLOO",time:"CZAS",destinationService:"CEL / POŁĄCZENIE",expected:"PRZEWIDYWANY",platform:"PERON",status:"STATUS",first:"PIERWSZY",last:"OSTATNI",satFirst:"SOB. PIERWSZY",satLast:"SOB. OSTATNI",sunFirst:"ND. PIERWSZY",sunLast:"ND. OSTATNI",weekdays:"Dni robocze",railLoading:"Pobieranie odjazdów z Kingston i Norbiton…",waterlooServices:"POCIĄGI DO WATERLOO",noTrains:"W tym źródle nie ma obecnie pociągów do Waterloo.",scheduled:"PLANOWANY",onTime:"Punktualnie",cancelled:"ODWOŁANY",delayed:"OPÓŹNIONY",callingAt:"PRZEZ",railLost:"⚠ BRAK INFORMACJI O POCIĄGACH — MOŻLIWE UTRUDNIENIA",noTrainInfo:"⚠ BRAK INFORMACJI O POCIĄGACH — MOŻLIWE ODWOŁANIA",railData:"Dane kolejowe:",feedback:"ZGŁOSZENIE SYSTEMOWE",foundBug:"ZNALEZIONO BŁĄD?",bugExplain:"Opisz Danowi i Kevowi, co się stało. Otworzy się aplikacja pocztowa z gotowym zgłoszeniem.",whatHappened:"CO SIĘ STAŁO?",describe:"Opisz problem…",cancel:"ANULUJ",send:"WYŚLIJ ZGŁOSZENIE",sendTo:"ZGŁOSZENIA SĄ ADRESOWANE DO",scanning:"SKANOWANIE SYSTEMU…",boot1:"URUCHAMIANIE SIECI TRANSPORTOWEJ",boot2:"ŁĄCZENIE Z ODJAZDAMI NA ŻYWO",boot3:"KALIBRACJA TABLICY LATCHMERE",bootGo:"WITAMY W CENTRUM DOWODZENIA"},
 zh:{welcome:"欢迎",journey:"旅程从这里开始",subtitle:"LATCHMERE LANE · 实时发车",show:"显示",fixBug:"报告问题",language:"语言",hint:"进入交通指挥中心或报告问题",chooseLanguage:"选择语言",languageHint:"仪表板界面将切换为您选择的语言。",back:"返回",live:"实时",connecting:"正在连接",offline:"离线",partial:"部分在线",brand:"实时公交到站",clock:"伦敦时间",morning:"早上好",afternoon:"下午好",night:"晚安",ticker1:"城市交通网络",ticker2:"实时发车信息",ticker3:"LATCHMERE LANE · 西行",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"实时数据 · 自动刷新",direction:"西行",stop:"公交站",line:"线路",destination:"目的地",due:"即将",hours:"运营时间",busFetch:"正在获取实时公交信息…",noBus:"目前没有预计到站的公交车。<br>即将再次检查。",busUnavailable:"无法加载实时公交信息。",updated:"更新时间",retrying:"正在重试",busData:"预测数据来自",railTitle:"火车发车信息",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"前往 WATERLOO 的首班和末班车",time:"时间",destinationService:"目的地 / 服务",expected:"预计",platform:"站台",status:"状态",first:"首班",last:"末班",satFirst:"周六首班",satLast:"周六末班",sunFirst:"周日首班",sunLast:"周日末班",weekdays:"工作日",railLoading:"正在加载 Kingston 和 Norbiton 的列车信息…",waterlooServices:"前往 WATERLOO 的列车",noTrains:"此车站数据中目前没有前往 Waterloo 的列车。",scheduled:"计划",onTime:"准点",cancelled:"已取消",delayed:"晚点",callingAt:"经停",railLost:"⚠ 列车信息中断 — 可能发生服务中断",noTrainInfo:"⚠ 没有列车信息 — 可能已取消",railData:"铁路数据：",feedback:"系统反馈",foundBug:"发现问题？",bugExplain:"告诉 Dan 和 Kev 发生了什么。您的邮件应用将打开并附上已填写的报告。",whatHappened:"发生了什么？",describe:"描述问题…",cancel:"取消",send:"发送报告",sendTo:"报告发送至",scanning:"正在扫描系统…",boot1:"正在初始化交通网络",boot2:"正在连接实时发车信息",boot3:"正在校准 Latchmere 显示屏",bootGo:"欢迎来到交通指挥中心"},
 ko:{welcome:"환영합니다",journey:"여정이 여기서 시작됩니다",subtitle:"LATCHMERE LANE · 실시간 출발",show:"보기",fixBug:"오류 신고",language:"언어",hint:"교통 관제 센터로 이동하거나 문제를 신고하세요",chooseLanguage:"언어 선택",languageHint:"대시보드 인터페이스가 선택한 언어로 변경됩니다.",back:"뒤로",live:"실시간",connecting:"연결 중",offline:"오프라인",partial:"일부 연결",brand:"실시간 버스 출발",clock:"런던 시간",morning:"좋은 아침",afternoon:"좋은 오후",night:"안녕히 주무세요",ticker1:"도시 교통 네트워크",ticker2:"실시간 출발 정보",ticker3:"LATCHMERE LANE · 서쪽 방향",ticker4:"KINGSTON + NORBITON → WATERLOO",ticker5:"실시간 데이터 · 자동 새로고침",direction:"서쪽 방향",stop:"버스 정류장",line:"노선",destination:"목적지",due:"도착 예정",hours:"운행 시간",busFetch:"실시간 버스 정보를 가져오는 중…",noBus:"현재 예상 버스가 없습니다.<br>잠시 후 다시 확인합니다.",busUnavailable:"실시간 도착 정보를 불러올 수 없습니다.",updated:"업데이트",retrying:"다시 시도 중",busData:"예측 제공:",railTitle:"열차 출발",railRoute:"KINGSTON & NORBITON → LONDON WATERLOO",railHours:"워털루행 첫차 및 막차",time:"시간",destinationService:"목적지 / 운행",expected:"예상",platform:"승강장",status:"상태",first:"첫차",last:"막차",satFirst:"토요일 첫차",satLast:"토요일 막차",sunFirst:"일요일 첫차",sunLast:"일요일 막차",weekdays:"평일",railLoading:"Kingston 및 Norbiton 열차 정보를 불러오는 중…",waterlooServices:"워털루행 열차",noTrains:"현재 이 역 정보에 워털루행 열차가 표시되지 않습니다.",scheduled:"예정",onTime:"정시",cancelled:"취소됨",delayed:"지연",callingAt:"정차역",railLost:"⚠ 열차 정보 연결 끊김 — 운행 장애 가능성",noTrainInfo:"⚠ 열차 정보 없음 — 운행 취소 가능성",railData:"철도 데이터:",feedback:"시스템 피드백",foundBug:"오류를 발견하셨나요?",bugExplain:"Dan과 Kev에게 문제를 알려주세요. 보고서가 작성된 이메일 앱이 열립니다.",whatHappened:"무슨 일이 있었나요?",describe:"문제를 설명하세요…",cancel:"취소",send:"보고서 보내기",sendTo:"보고서 수신:",scanning:"시스템 검사 중…",boot1:"교통 네트워크 초기화 중",boot2:"실시간 출발 정보 연결 중",boot3:"Latchmere 디스플레이 보정 중",bootGo:"교통 관제 센터에 오신 것을 환영합니다"}
 };
 const staticMap={
  "#introScreen .intro-kicker":"journey","#introScreen h1":"welcome","#introScreen .intro-subtitle":"subtitle",
  "#introScreen .show-button-label":"show",".intro-hint":"hint","#openBugReport span:last-child":"fixBug",
  "#openLanguage span:last-child":"language","#languageTitle":"chooseLanguage",".language-dialog p":"languageHint",
  "#backToWelcome span":"back","#busBrandSub":"brand","#clockLabel":"clock","#busDirection":"direction",
  "#busStopLabel":"stop","#busLineLabel":"line","#busDestinationLabel":"destination","#busDueLabel":"due",
  "#busHoursTitle":"hours","#railTitle":"railTitle","#railHoursHeading":"railHours",
  "#trainTimeLabel":"time","#trainDestinationLabel":"destinationService","#trainExpectedLabel":"expected",
  "#trainPlatformLabel":"platform","#trainStatusLabel":"status"
 };
 const tickerMap={".ticker-tag":"ticker1",".ticker-track span:nth-of-type(1)":"ticker2",".ticker-track span:nth-of-type(2)":"ticker3",".ticker-track span:nth-of-type(3)":"ticker4",".ticker-track span:nth-of-type(4)":"ticker5"};
 const langNames={en:"English",vi:"Tiếng Việt",fr:"Français",es:"Español",de:"Deutsch",pl:"Polski",zh:"简体中文",ko:"한국어"};
 let current="en";
 const get=k=>(translations[current]&&translations[current][k])||translations.en[k]||k;
 window.dashboardText=get;
 function apply(lang){
  current=translations[lang]?lang:"en";
  document.documentElement.lang=current;
  Object.entries(staticMap).forEach(([selector,key])=>{const el=document.querySelector(selector);if(el)el.textContent=get(key)});
  Object.entries(tickerMap).forEach(([selector,key])=>{const el=document.querySelector(selector);if(el)el.textContent=get(key)});
  const live=document.getElementById("liveText");if(live){const v=live.textContent.trim();live.textContent=get(v==="LIVE"?"live":v==="CONNECTING"?"connecting":v==="DATA UNAVAILABLE"?"offline":v.toLowerCase())}
  const railLive=document.getElementById("railLive");if(railLive){const v=railLive.textContent.trim();railLive.textContent=get(v==="LIVE"?"live":v==="CONNECTING"?"connecting":v==="OFFLINE"?"offline":v==="PARTIAL"?"partial":v.toLowerCase())}
  const busData=document.getElementById("busDataLabel");if(busData)busData.innerHTML=get("busData")+' <strong>TfL Open Data</strong>';
  const railData=document.getElementById("railDataLabel");if(railData)railData.innerHTML=get("railData")+' <strong>railinfo.uk</strong> (Network Rail / National Rail feeds)';
  const greeting=document.getElementById("timeGreeting");
  if(greeting){const h=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"}).format(new Date()));greeting.textContent=get(h>=5&&h<12?"morning":h>=12&&h<18?"afternoon":"night")}
  const bugTitle=document.getElementById("bugTitle");if(bugTitle)bugTitle.textContent=get("foundBug");
  const bugP=document.querySelector(".bug-dialog p");if(bugP)bugP.textContent=get("bugExplain");
  const bugLabel=document.querySelector('label[for="bugDescription"]');if(bugLabel)bugLabel.textContent=get("whatHappened");
  const bugField=document.getElementById("bugDescription");if(bugField)bugField.placeholder=get("describe");
  const cancel=document.getElementById("cancelBugReport");if(cancel)cancel.textContent=get("cancel");
  const send=document.getElementById("sendBugReport");if(send)send.innerHTML=get("send")+' <span>➜</span>';
  const bugKicker=document.querySelector(".bug-dialog-kicker");if(bugKicker)bugKicker.lastChild.textContent=" "+get("feedback");
  const foot=document.querySelector(".bug-footnote");if(foot)foot.textContent=get("sendTo")+" DANIELNGUYEN15555@GMAIL.COM";
  const show=document.querySelector(".show-button-label");if(show&&!document.getElementById("showDashboard").disabled)show.textContent=get("show");
  document.querySelectorAll("#languageOptions button").forEach(b=>b.classList.toggle("selected",b.dataset.lang===current));
  translateDynamic();
  try{localStorage.setItem("latchmere-language",current)}catch(e){}
 }
 function translateDynamic(){
  const replacements={
   "Fetching live arrivals…":get("busFetch"),"No live buses currently predicted.":get("noBus").split("<br>")[0],
   "Checking again shortly.":get("noBus").split("<br>")[1]||"","Unable to load live arrivals.":get("busUnavailable"),
   "SERVICE HOURS":get("hours"),"Checking first and last bus times…":get("busFetch"),
   "SCHEDULED":get("scheduled"),"LIVE":get("live"),"EXPECTED":get("expected"),
   "On time":get("onTime"),"CANCELLED":get("cancelled"),"DELAYED":get("delayed"),
   "CALLING AT":get("callingAt"),"WATERLOO SERVICES":get("waterlooServices"),
   "No Waterloo-bound trains are currently listed in this station feed.":get("noTrains"),
   "Loading Kingston and Norbiton train departures…":get("railLoading"),
   "FIRST":get("first"),"LAST":get("last"),"SAT FIRST":get("satFirst"),"SAT LAST":get("satLast"),
   "SUN FIRST":get("sunFirst"),"SUN LAST":get("sunLast"),"Weekdays":get("weekdays"),
   "CONNECTING":get("connecting"),"LIVE":get("live"),"OFFLINE":get("offline"),"PARTIAL":get("partial"),
   "UPDATED":get("updated"),"RETRYING":get("retrying")
  };
  ["arrivals","busServiceHours","railDepartures","railHours"].forEach(id=>{
   const root=document.getElementById(id);if(!root)return;
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
   const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
   nodes.forEach(n=>{const raw=n.nodeValue.trim();if(replacements[raw] && replacements[raw]!==raw)n.nodeValue=n.nodeValue.replace(raw,replacements[raw])});
  });
 }
 window.applyDashboardLanguage=apply;
 ["arrivals","busServiceHours","railDepartures","railHours"].forEach(id=>{
  const root=document.getElementById(id);
  if(root)new MutationObserver(()=>translateDynamic()).observe(root,{childList:true,subtree:true,characterData:true});
 });
 document.getElementById("languageOptions").addEventListener("click",e=>{
  const b=e.target.closest("button[data-lang]");if(!b)return;
  apply(b.dataset.lang);
  document.getElementById("languageModal").classList.remove("open");
  document.getElementById("languageModal").setAttribute("aria-hidden","true");
 });
 const modal=document.getElementById("languageModal");
 document.getElementById("openLanguage").addEventListener("click",()=>{modal.classList.add("open");modal.setAttribute("aria-hidden","false")});
 document.getElementById("closeLanguage").addEventListener("click",()=>{modal.classList.remove("open");modal.setAttribute("aria-hidden","true")});
 modal.addEventListener("click",e=>{if(e.target===modal){modal.classList.remove("open");modal.setAttribute("aria-hidden","true")}});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"){modal.classList.remove("open");modal.setAttribute("aria-hidden","true")}});
 let saved="en";try{saved=localStorage.getItem("latchmere-language")||"en"}catch(e){}
 apply(saved);
})();

/* Extracted inline JavaScript block 3 */
(function wireEchoManualScroll() {
  const up = document.getElementById("echoTourUp");
  const down = document.getElementById("echoTourDown");
  if (up) up.addEventListener("click", () => {
    window.scrollBy({top: -Math.max(260, window.innerHeight * 0.72), left: 0, behavior: "smooth"});
  });
  if (down) down.addEventListener("click", () => {
    window.scrollBy({top: Math.max(260, window.innerHeight * 0.72), left: 0, behavior: "smooth"});
  });
})();

/* Extracted inline JavaScript block 4 */
(function wireCeliaDock() {
  const dock = document.getElementById('celiaDock');
  const launcher = document.getElementById('celiaLauncher');
  const close = document.getElementById('closeCeliaDock');
  const settingsShortcut = document.getElementById('openCeliaFromSettings');
  const settings = document.getElementById('announcementSettings');
  if (!dock || !launcher || !close) return;
  function openDock() {
    dock.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.querySelector('.celia-launcher-arrow').textContent = '▼';
  }
  function closeDock() {
    dock.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.querySelector('.celia-launcher-arrow').textContent = '▲';
  }
  launcher.addEventListener('click', () => dock.hidden ? openDock() : closeDock());
  close.addEventListener('click', closeDock);
  if (settingsShortcut) settingsShortcut.addEventListener('click', () => {
    if (settings && settings.open) settings.close();
    openDock();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !dock.hidden) closeDock();
  });
})();

/* Extracted inline JavaScript block 5 */
(function stationDisplayMode() {
  const button = document.getElementById('stationModeButton');
  if (!button) return;
  function setMode(active) {
    document.body.classList.toggle('station-mode', active);
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? 'EXIT STATION MODE' : 'STATION MODE ⛶';
    button.title = active ? 'Exit full-screen station display' : 'Switch to full-screen station display';
  }
  button.addEventListener('click', async () => {
    const active = !document.body.classList.contains('station-mode');
    setMode(active);
    if (active && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); }
      catch (err) { /* Station layout still activates if fullscreen is blocked. */ }
    } else if (!active && document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch (err) {}
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setMode(false);
  });
})();

