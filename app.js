// ==========================================
// SMART BUILDING - GROUP A
// Dashboard Data Controller
// ==========================================

// Replace this placeholder ONLY with the
// approved read-only API endpoint.
const API_URL = "YOUR_APPROVED_READ_ONLY_ENDPOINT";

const POLL_INTERVAL_MS = 30000;

// ------------------------------------------
// Helper: Update HTML elements
// ------------------------------------------

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent =
            value === null || value === undefined || value === ""
                ? "--"
                : value;
    }
}

// ------------------------------------------
// Helper: Format numeric values
// ------------------------------------------

function formatNumber(value, unit) {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value)
    ) {
        return "--";
    }

    return `${value.toFixed(1)} ${unit}`;
}

// ------------------------------------------
// Helper: Window status
// ------------------------------------------

function formatWindow(windowData) {
    if (
        !windowData ||
        typeof windowData.open !== "boolean"
    ) {
        return "Unknown";
    }

    return windowData.open ? "Open" : "Closed";
}

// ------------------------------------------
// Helper: Data freshness
// ------------------------------------------

function freshness(timestamp) {
    if (!timestamp) {
        return "Unknown";
    }

    const time = Date.parse(timestamp);

    if (!Number.isFinite(time)) {
        return "Unknown";
    }

    const age = Date.now() - time;

    if (age < 0) {
        return "Clock mismatch";
    }

    if (age <= 90000) {
        return "Fresh";
    }

    if (age <= 180000) {
        return "Delayed";
    }

    return "Stale";
}

// ------------------------------------------
// Main: Refresh dashboard
// ------------------------------------------

let currentAccessCode = "";
let refreshTimer = null;

async function refreshDashboard() {
    if (API_URL === "YOUR_APPROVED_READ_ONLY_ENDPOINT") {
        setText("connectionStatus", "API Not Configured");
        setText("dataStatus", "Waiting for approved API");
        setText("lastUpdate", "--");
        return;
    }

    try {
        setText("connectionStatus", "Connecting...");

        const response = await fetch(API_URL, {
            method: "GET",
            cache: "no-store",
            headers: {
                // The read-only API must validate this bearer token.
                "Authorization": `Bearer ${currentAccessCode}`
            }
        });

        if (response.status === 401 || response.status === 403) {
            setText("connectionStatus", "Access Denied");
            setText("dataStatus", "Invalid access code");
            throw new Error("Access code rejected by the read-only API");
        }

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        const record = data.latest_group_a;
        const windows = data.windows;

        if (!record || typeof record !== "object") {
            throw new Error("Invalid API response: missing latest_group_a");
        }

        // Environmental measurements

        setText(
            "temperature",
            formatNumber(record.temperature_c, "°C")
        );

        setText(
            "humidity",
            formatNumber(record.humidity_rh, "%")
        );

        setText(
            "illuminance",
            formatNumber(record.illuminance_lux, "lux")
        );

        setText(
            "eco2",
            formatNumber(record.eco2_ppm, "ppm")
        );

        setText(
            "tvoc",
            formatNumber(record.tvoc_ppb, "ppb")
        );

        // Motion detection

        const motion =
            typeof record.motion_detected === "boolean"
                ? record.motion_detected
                    ? "Detected"
                    : "Not detected"
                : "Unknown";

        setText("motion", motion);

        // Window monitoring

        setText("window1", formatWindow(windows?.W1));
        setText("window2", formatWindow(windows?.W2));

        // Device information

        setText("deviceId", record.device_id);

        // Last update time

        const timestamps = [
            record.recorded_at,
            windows?.W1?.recorded_at,
            windows?.W2?.recorded_at
        ]
            .filter(Boolean)
            .map(Date.parse)
            .filter(Number.isFinite);

        const latestTimestamp = timestamps.length
            ? new Date(Math.max(...timestamps)).toISOString()
            : null;

        setText(
            "lastUpdate",
            latestTimestamp
                ? new Date(latestTimestamp).toLocaleString()
                : "--"
        );

        // Data freshness

        const status = freshness(record.recorded_at);

        setText("dataStatus", status);
        setText("connectionStatus", "Connected");

    } catch (error) {
        console.error("Dashboard Error:", error);

        if (document.getElementById("connectionStatus").textContent !== "Access Denied") {
            setText("connectionStatus", "Connection Error");
        }
        setText("dataStatus", "Unavailable");
        setText("lastUpdate", "--");
    }
}

// ------------------------------------------
// Access-code connection
// ------------------------------------------

const accessInput = document.getElementById("accessCode");
const connectButton = document.getElementById("connectButton");
const accessMessage = document.getElementById("accessMessage");
const dashboardContent = document.getElementById("dashboardContent");

async function connectDashboard() {
    const enteredCode = accessInput.value.trim();

    if (!enteredCode) {
        accessMessage.textContent = "Please enter the access code.";
        accessInput.focus();
        return;
    }

    if (API_URL === "YOUR_APPROVED_READ_ONLY_ENDPOINT") {
        accessMessage.textContent =
            "The dashboard API has not been configured yet. Ask your instructor for the approved read-only API endpoint.";
        setText("connectionStatus", "API Not Configured");
        return;
    }

    currentAccessCode = enteredCode;
    connectButton.disabled = true;
    connectButton.textContent = "Connecting...";
    accessMessage.textContent = "Checking access code...";

    try {
        await refreshDashboard();

        const status = document.getElementById("connectionStatus").textContent;

        if (status === "Connected") {
            dashboardContent.classList.remove("dashboard-locked");
            accessMessage.textContent = "Connected successfully.";
            accessInput.value = "";
            if (refreshTimer) clearInterval(refreshTimer);
            refreshTimer = setInterval(refreshDashboard, POLL_INTERVAL_MS);
        } else {
            currentAccessCode = "";
            accessMessage.textContent =
                "Could not connect. Check the access code and API configuration.";
            dashboardContent.classList.add("dashboard-locked");
        }
    } catch (error) {
        currentAccessCode = "";
        dashboardContent.classList.add("dashboard-locked");
        accessMessage.textContent = "Connection failed. Please try again.";
    } finally {
        connectButton.disabled = false;
        connectButton.textContent = "Connect";
    }
}

connectButton.addEventListener("click", connectDashboard);
accessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectDashboard();
});

// Do not request dashboard data until the user enters an access code.