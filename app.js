// SMART BUILDING - GROUP A
// Dashboard data controller

// Replace this placeholder only with the instructor-approved
// read-only API endpoint. Do not put service_role keys here.
const API_URL = "YOUR_APPROVED_READ_ONLY_ENDPOINT";
const POLL_INTERVAL_MS = 30000;

let currentAccessCode = "";
let refreshTimer = null;

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent =
            value === null || value === undefined || value === ""
                ? "--"
                : value;
    }
}

function formatNumber(value, unit) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "--";
    }
    return `${value.toFixed(1)} ${unit}`;
}

function formatWindow(windowData) {
    if (!windowData || typeof windowData.open !== "boolean") {
        return "Unknown";
    }
    return windowData.open ? "Open" : "Closed";
}

function freshness(timestamp) {
    if (!timestamp) return "Unknown";

    const time = Date.parse(timestamp);
    if (!Number.isFinite(time)) return "Unknown";

    const age = Date.now() - time;
    if (age < 0) return "Clock mismatch";
    if (age <= 90000) return "Fresh";
    if (age <= 180000) return "Delayed";
    return "Stale";
}

async function refreshDashboard() {
    if (API_URL === "YOUR_APPROVED_READ_ONLY_ENDPOINT") {
        setText("connectionStatus", "API Not Configured");
        setText("dataStatus", "Waiting for approved API");
        setText("error", "The dashboard layout is ready, but the approved read-only API endpoint has not been configured yet.");
        return false;
    }

    try {
        setText("connectionStatus", "Connecting...");
        setText("error", "");

        const response = await fetch(API_URL, {
            method: "GET",
            cache: "no-store",
            headers: {
                "Authorization": `Bearer ${currentAccessCode}`
            }
        });

        if (response.status === 401 || response.status === 403) {
            throw new Error("Access code was not accepted (401/403).");
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const record = data.latest_group_a;
        const windows = data.windows || {};

        if (!record || typeof record !== "object") {
            throw new Error("Invalid API response: latest_group_a is missing.");
        }

        setText("temperature", formatNumber(record.temperature_c, "°C"));
        setText("humidity", formatNumber(record.humidity_rh, "%"));
        setText("illuminance", formatNumber(record.illuminance_lux, "lux"));
        setText("eco2", formatNumber(record.eco2_ppm, "ppm"));
        setText("tvoc", formatNumber(record.tvoc_ppb, "ppb"));

        setText(
            "motion",
            typeof record.motion_detected === "boolean"
                ? (record.motion_detected ? "Detected" : "Not detected")
                : "Unknown"
        );

        setText("window1", formatWindow(windows.W1));
        setText("window2", formatWindow(windows.W2));
        setText("deviceId", record.device_id || "--");
        setText("dataStatus", freshness(record.recorded_at));

        const timestamps = [
            record.recorded_at,
            windows.W1?.recorded_at,
            windows.W2?.recorded_at
        ].filter(Boolean).map(Date.parse).filter(Number.isFinite);

        const latest = timestamps.length
            ? new Date(Math.max(...timestamps))
            : null;

        setText("lastUpdate", latest ? latest.toLocaleString() : "--");
        setText("lastSample", record.recorded_at
            ? new Date(record.recorded_at).toLocaleString()
            : "--");

        setText("connectionStatus", "Connected");
        return true;
    } catch (error) {
        console.error("Dashboard error:", error);
        setText("connectionStatus", "Connection error");
        setText("dataStatus", "Unavailable");
        setText("error", error.message || "Could not load dashboard data.");
        return false;
    }
}

const accessInput = document.getElementById("accessCode");
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");
const accessMessage = document.getElementById("accessMessage");

async function connectDashboard() {
    const enteredCode = accessInput.value.trim();

    if (!enteredCode) {
        accessMessage.textContent = "Please enter the access code provided by your instructor.";
        accessInput.focus();
        return;
    }

    if (API_URL === "YOUR_APPROVED_READ_ONLY_ENDPOINT") {
        setText("connectionStatus", "API Not Configured");
        setText("dataStatus", "Waiting for approved API");
        accessMessage.textContent = "The access-code box is ready, but the approved API endpoint has not been supplied yet.";
        setText("error", "Ask your instructor for the approved read-only API endpoint and its authentication method.");
        return;
    }

    currentAccessCode = enteredCode;
    connectButton.disabled = true;
    connectButton.textContent = "Connecting...";
    accessMessage.textContent = "Checking access code...";

    const connected = await refreshDashboard();

    if (connected) {
        accessInput.value = "";
        accessMessage.textContent = "Connected successfully.";
        disconnectButton.disabled = false;

        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshDashboard, POLL_INTERVAL_MS);
    } else {
        currentAccessCode = "";
        accessMessage.textContent = "Connection was not completed. Check the access code and API settings.";
    }

    connectButton.disabled = false;
    connectButton.textContent = "Connect";
}

function disconnectDashboard() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }

    currentAccessCode = "";
    accessInput.value = "";
    disconnectButton.disabled = true;
    setText("connectionStatus", "Not connected");
    setText("dataStatus", "Waiting for connection");
    accessMessage.textContent = "Disconnected. Enter the access code to connect again.";
}

connectButton.addEventListener("click", connectDashboard);
disconnectButton.addEventListener("click", disconnectDashboard);
accessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectDashboard();
});

// Show the complete dashboard layout immediately.
// Live values appear after the approved API is configured and connected.
