# OpenEVSE Homebridge Plugin - Investigation Issues

## Context
This is a refactored Homebridge plugin for OpenEVSE WiFi v5.1.5. It currently uses MQTT for real-time updates and exposes a BatteryService + LightSensor (power) to HomeKit.

---

## Issues to Investigate

### 1. MQTT Topic Name Verification
**File:** `index.js` lines 43-45
**Problem:** The plugin subscribes to:
- `${baseTopic}/announcement/state`
- `${baseTopic}/amp`
- `${baseTopic}/watt`

**Question:** Do these match the actual MQTT topics published by OpenEVSE WiFi v5.1.5? Common variations include:
- `openevse/announce/state` vs `openevse/announcement/state`
- `openevse/state` 
- Different casing or structure

**Task:** Research the correct MQTT topic structure for OpenEVSE WiFi v5.1.5 and verify/update subscriptions.

---

### 2. Hardcoded Charge Level (SoC)
**File:** `index.js` line 19
**Problem:** `this.chargeLevel = 100` is hardcoded and never updated from real data.

**Question:** 
- Does OpenEVSE provide State of Charge (SoC) data via MQTT or HTTP API?
- If not, should we remove BatteryLevel display entirely, or show a static "connected" indicator?
- Alternative: Use BatteryLevel as a proxy for session progress if total capacity is configured?

**Task:** Determine best approach for BatteryLevel characteristic given available data.

---

### 3. No HTTP Fallback
**File:** `index.js` — no HTTP polling implemented
**Problem:** If MQTT broker is down or credentials are wrong, the plugin shows stale data with no indication of failure.

**Task:** 
- Research OpenEVSE HTTP API endpoints for status retrieval
- Propose implementation for HTTP polling as fallback or initial state fetch
- Consider polling interval (current config implies 10s was used before)

---

### 4. EVSE State Mapping Accuracy
**File:** `index.js` lines 52-57
**Problem:** Comment says "OpenEVSE States: 1=Void, 2=Not Connected, 3=Connected, 4=Charging" but code maps:
```javascript
this.isCharging = (evseState === 3);
```

**Question:** This appears inconsistent — if state 3 = Connected and state 4 = Charging, shouldn't we check for state 4?

**Task:** Verify OpenEVSE WiFi v5.1.5 state codes and correct mapping.

---

---

## Resolution Log (Feb 19, 2026)

### ✅ Issue 1: MQTT Topic Names — RESOLVED
**Fix:** Changed `${baseTopic}/announcement/state` → `${baseTopic}/state`

### ✅ Issue 2: Hardcoded Charge Level — RESOLVED  
**Fix:** Now uses `soc` from HTTP API if available, falls back to 0%/100% based on connection state

### ✅ Issue 3: No HTTP Fallback — RESOLVED
**Fix:** Added `fetchStatus()` method with 30s polling interval, proper error handling

### ✅ Issue 4: State Mapping — RESOLVED
**Fix:** `isCharging = (state === 3 || state === 4)` — handles both charging and ventilation states

### 🎁 Bonus Improvements
- MQTT reconnection handling with `offline`/`reconnect` event listeners
- Error state indicated via `StatusLowBattery` characteristic
- Unified `processUpdate()` method for clean architecture
