# OpenEVSE Plugin - BatteryService → OutletService Refactor

## Summary
Refactored the Homebridge plugin to use **OutletService** instead of BatteryService for better representation of EVSE connection status in iOS Home app.

---

## Changes Made

### 1. Primary Service Replacement
- **Removed:** `Service.Battery` (inappropriate for Ford EVs that don't report SoC)
- **Added:** `Service.Outlet` as the primary service
- **Mapping:**
  - Outlet **On** = EVSE Connected (state 2), Charging (state 3), or Ventilation Required (state 4)
  - Outlet **Off** = EVSE Disconnected (state 1), Sleeping (state 254), or Error (state 255)

### 2. Read-Only Implementation
- **Removed:** All `setOn` handler capabilities
- **Result:** Outlet status is purely informational, cannot be controlled via Home app
- **Benefit:** Prevents accidental override of vehicle charging schedules

### 3. Enhanced State Characteristics
- **`On`**: Reflects connection state (connected/charging = true)
- **`InUse`**: Reflects active charging (states 3 & 4 only)
- **`OutletInUse`**: Indicates error state (state 255)

### 4. BatteryService Removal
- Completely removed BatteryService and all SoC-related code
- Removed `chargeLevel` state variable
- Removed battery level update logic from `processUpdate()` and `updateHomeKit()`

### 5. Preserved Features
- ✅ **LightSensor linked service** for real-time wattage display (unchanged)
- ✅ **HTTP polling fallback** (30s interval)
- ✅ **MQTT real-time updates** with reconnection handling
- ✅ **OpenEVSE WiFi v5.1.5** state mapping maintained
- ✅ **Unified `processUpdate()`** method for clean architecture

---

## Configuration Notes for James

### config.json Changes

**No changes required** if you're using the existing configuration. The plugin maintains backward compatibility with:

```json
{
  "accessory": "OpenEVSE",
  "name": "EV Charger",
  "host": "openevse.local",
  "mqtt_host": "your-mqtt-broker",
  "mqtt_port": 1883,
  "mqtt_user": "optional",
  "mqtt_pass": "optional",
  "mqtt_topic": "openevse"
}
```

### Home App Behavior

**Before (BatteryService):**
- Showed battery percentage (0% or 100% based on connection)
- Showed charging status
- Required tapping into accessory to see details

**After (OutletService):**
- Shows prominent On/Off tile (On = Connected/Charging)
- Shows "In Use" indicator when actively charging
- Power consumption visible via linked LightSensor (wattage)
- **Cannot be toggled** (read-only status only)

### Visual Result in iOS Home App

The EV Charger will now appear as an **Outlet** tile:
- **Green/On** when vehicle is connected and ready/charging
- **Gray/Off** when vehicle is disconnected
- Shows real-time power draw in the LightSensor service
- No control capability (status only)

---

## Files Modified

- `index.js` - Complete refactor from BatteryService to OutletService

## Files Unchanged

- `ISSUES.md` - Historical context preserved
- `config.json` - No configuration changes needed
- `package.json` - No dependency changes

---

## Testing Recommendations

1. **Restart Homebridge** after deploying the new `index.js`
2. **Check Home app** - the accessory should now show as an Outlet
3. **Test connection states:**
   - Plug in EV → Outlet should turn On
   - Unplug EV → Outlet should turn Off
   - Start charging → "In Use" indicator should activate
4. **Verify power display** - LightSensor should show real-time wattage

---

## Why This Approach?

**Ford EV Compatibility:** Ford vehicles don't report State of Charge (SoC) to OpenEVSE, making BatteryService misleading.

**User Experience:** Outlet provides a clear, binary status (Connected vs Disconnected) that's immediately visible as a prominent tile.

**Safety:** Read-only design prevents HomeKit automation from accidentally interrupting vehicle charging schedules.

**Simplicity:** Removes unnecessary battery level abstraction while keeping the useful power monitoring feature.
