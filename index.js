'use strict';

const http = require('http');
const mqtt = require('mqtt');

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('OpenEVSE', OpenEVSEAccessory);
};

class OpenEVSEAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'EV Charger';
    this.host = config.host;
    this.baseTopic = config.mqtt_topic || 'openevse';
    
    // Internal State
    this.evseState = 1; // Default to Disconnected
    this.chargeLevel = 100; // Battery Level (SoC)
    this.isCharging = false;
    this.watts = 0;
    this.amps = 0;

    // 1. Battery Service (The Main Tile)
    this.batteryService = new Service.Battery(this.name);
    
    // 2. Power Sensor (LightSensor hack for kW)
    this.powerService = new Service.LightSensor(this.name + ' Power');

    // 3. Accessory Info
    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'OpenEVSE')
      .setCharacteristic(Characteristic.Model, 'WiFi v5.1.5')
      .setCharacteristic(Characteristic.SerialNumber, this.host || 'Unknown');

    // Initial Setup
    this.initMQTT();
    
    // Initial HTTP Fetch & Poll Setup
    if (this.host) {
      this.fetchStatus();
      this.pollInterval = setInterval(() => this.fetchStatus(), 30000);
    } else {
      this.log.warn('No "host" configured. HTTP polling disabled.');
    }
  }

  /**
   * HTTP Polling Fallback
   */
  fetchStatus() {
    const url = `http://${this.host}/status`;
    
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          this.log.debug(`HTTP Status received from ${this.host}`);
          
          this.processUpdate({
            state: status.state,
            watt: status.watt,
            soc: status.soc,
            amp: status.amp
          });
        } catch (e) {
          this.log.error(`Error parsing HTTP response from ${this.host}: ${e.message}`);
        }
      });
    }).on('error', (err) => {
      this.log.error(`HTTP Polling Error to ${this.host}: ${err.message}`);
    });
  }

  initMQTT() {
    if (!this.config.mqtt_host) {
      this.log.warn('No "mqtt_host" configured. MQTT disabled.');
      return;
    }

    const broker = `mqtt://${this.config.mqtt_host}:${this.config.mqtt_port || 1883}`;
    const options = {
      reconnectPeriod: 5000, // Try reconnecting every 5s
    };
    
    if (this.config.mqtt_user) {
      options.username = this.config.mqtt_user;
      options.password = this.config.mqtt_pass;
    }

    this.log(`Connecting to MQTT: ${broker}`);
    this.client = mqtt.connect(broker, options);

    this.client.on('connect', () => {
      this.log('MQTT Connected');
      this.client.subscribe(`${this.baseTopic}/state`);
      this.client.subscribe(`${this.baseTopic}/amp`);
      this.client.subscribe(`${this.baseTopic}/watt`);
    });

    this.client.on('message', (topic, message) => {
      const value = message.toString();
      const payload = {};

      if (topic.endsWith('/state')) {
        payload.state = parseInt(value);
      } else if (topic.endsWith('/amp')) {
        payload.amp = parseFloat(value);
      } else if (topic.endsWith('/watt')) {
        payload.watt = parseInt(value);
      }

      this.processUpdate(payload);
    });

    this.client.on('error', (err) => {
      this.log.error(`MQTT Error: ${err.message}`);
    });

    this.client.on('offline', () => {
      this.log.warn('MQTT client went offline. Retrying...');
    });

    this.client.on('reconnect', () => {
      this.log('MQTT attempting to reconnect...');
    });
  }

  /**
   * Unified Processor for state updates from MQTT or HTTP
   */
  processUpdate(data) {
    let updated = false;

    // Update EVSE State
    if (data.state !== undefined) {
      this.evseState = data.state;
      // States: 1=Disconnected, 2=Connected, 3=Charging, 4=Ventilation Required, 254=Sleeping, 255=Error
      this.isCharging = (this.evseState === 3 || this.evseState === 4);
      updated = true;
    }

    // Update SoC / Battery Level
    if (data.soc !== undefined) {
      this.chargeLevel = data.soc;
    } else if (data.state !== undefined) {
      // Dynamic Fallback: 0% if disconnected (state 1), 100% if anything else (connected/charging 2-4)
      this.chargeLevel = (this.evseState === 1) ? 0 : 100;
    }

    // Update Watts (LightSensor hack)
    if (data.watt !== undefined) {
      this.watts = data.watt;
      this.powerService.updateCharacteristic(
        Characteristic.CurrentAmbientLightLevel, 
        Math.max(0.0001, this.watts)
      );
    }

    // Update Amps
    if (data.amp !== undefined) {
      this.amps = data.amp;
    }

    if (updated || data.soc !== undefined) {
      this.updateHomeKit();
    }
  }

  updateHomeKit() {
    // Map EVSE state to HomeKit Battery states
    // ChargingState: 0=Not Charging, 1=Charging, 2=Not Chargeable
    const hkChargingState = this.isCharging ? 
      Characteristic.ChargingState.CHARGING : 
      Characteristic.ChargingState.NOT_CHARGING;

    this.batteryService.updateCharacteristic(Characteristic.ChargingState, hkChargingState);
    this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, this.chargeLevel);
    
    // Status Low Battery used as an Error indicator
    this.batteryService.updateCharacteristic(
      Characteristic.StatusLowBattery, 
      (this.evseState === 255) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    );
  }

  getServices() {
    return [this.infoService, this.batteryService, this.powerService];
  }
}
