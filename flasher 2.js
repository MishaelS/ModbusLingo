/**
 * Скрипт автоматизирует процесс сканирования и прошивки устройств по Modbus.
 * 
 * Основная логика работы:
 * 1. При нажатии кнопки "Scan" выполняется сканирование шины Modbus.
 *    - Все найденные устройства добавляются в список `knownDevices`.
 *    - Новые устройства получают флаг `firmwareUpdated = 0` (не прошито).
 * 
 * 2. При нажатии кнопки "Firmware" происходит прошивка устройств.
 *    - Все устройства с `firmwareUpdated = 0` прошиваются и получают `firmwareUpdated = 1`.
 *    - Если устройства с `modbusId = 1` нет, выбирается первое прошитое и назначается `modbusId = 1`.
 * 
 * 3. Устройства идентифицируются по серийному номеру (`serial`), а их текущее состояние (modbusId, прошито или нет)
 *    хранится в `knownDevices`, который реализован в виде Map для быстрого доступа.
 * 
 * 4. Обновление `modbusId` выполняется через команду `wb-modbus-scanner`.
 * 
 * Планы по улучшению:
 * - Добавить механизм проверки версии прошивки перед прошивкой, чтобы не обновлять устройства без необходимости.
 * - Реализовать автоматическое сканирование устройств с определенным интервалом.
 * - Улучшить обработку ошибок, чтобы избежать зависания при сбоях в связи.
 * - Добавить логирование состояний устройств в базу данных или файл для дальнейшего анализа.
 * 
 * === ОПИСАНИЕ ===
 * Управляет устройствами по Modbus: сканирует, прошивает, назначает ID, поддерживает Master-устройство (ID = 1).
 * 
 * === ПЛАНЫ ДОРАБОТКИ ===
 * - **Проверка версии прошивки** → исключать актуальные версии из обновления.  
 * - **Автосканирование** → периодически обновлять список устройств.  
 * - **Обнаружение отключений** → логировать потерю связи, пересканировать.  
 * - **Логирование** → записывать изменения и ошибки в файл/БД.  
 * - **Статусы прошивки** → показывать процесс и ошибки в UI.  
 * - **Очередь прошивки** → обновлять устройства по одному.  
 * - **Уведомления** → сообщать о смене Master, сбоях (Telegram, Web UI).  
 * - **Гибкая настройка** → конфигурация через JSON/Web UI.  
 * - **Обнаружение конфликтов ID** → исправлять дубли.  
 * - **Обработка ошибок** → ретраи, пропуск проблемных устройств.  
 * - **Тестовый режим** → проверка без изменений в устройствах.  
 */

// ===================================================================================================== //

const log = new Logger("flasherRule");
const { execSync } = require("child_process");

let deviceName = "testFlasher";
let knownDevices = new Map(); // Список известных устройств в памяти
let isFirstRun = true; // Флаг первого запуска


// ===================================================================================================== //

// Виртуальное устройство
defineVirtualDevice(deviceName, {
	driverMode: false,
	cells: {
		"Scan": {
			type: "pushbutton",
			value: 1,
			readonly: false,
			title: {
				en: "Scan",
				ru: "Сканировать"
			}
		},
		"Firmware": {
			type: "pushbutton",
			value: 1,
			readonly: false,
			title: {
				en: "Firmware",
				ru: "Прошивать"
			}
		},
		"Reset": {
			type: "pushbutton",
			value: 1,
			readonly: false,
			title: {
				en: "Reset",
				ru: "Сбросить modbusId"
			}
		},
		"Status": {
			type: "text",
			value: "Ожидание",
			readonly: true,
			title: {
				en: "Status",
				ru: "Статус"
			}
		}
	}
});

// Обработчик кнопки сканирования
defineRule("scanDevices", {
	whenChanged: "{}/Scan/on".format(deviceName),
	then: () => {
		log.info("Кнопка 'Сканировать' нажата");
		updateStatus("Сканирование...");
		scanAndUpdateDevices();
	}
});

// Обработчик кнопки сброса
defineRule("resetDevices", {
	whenChanged: "{}/Reset/on".format(deviceName),
	then: () => {
		log.info("Кнопка 'Сброса modbusId' нажата");
		updateStatus("Сброс...");
		resetDevices();
	}
});

// Обработчик кнопки сброса
defineRule("firmwareDevices", {
	whenChanged: "{}/Firmware/on".format(deviceName),
	then: () => {
		log.info("Кнопка 'Прошивать' нажата");
		updateStatus("Прошить...");
		firmwareDeviceIds(scanModbusDevices());
	}
});

// Обновляет статус виртуального устройства
// function updateStatus(status) {
//     dev[deviceName]["Status"] = status;  // Обновляем статус напрямую в виртуальном устройстве
//     log.info(`Статус обновлен: ${status}`);
// }
function updateStatus(status) {
	const device = knownDevices.get(deviceName);
	if (device) {
		device.Status = status;
		log.info(`Статус обновлен: ${status}`);
	}
}

function resetDevices() {
	isFirstRun = false;
	const devices = scanModbusDevices();

	for (const device of devices) {
		setModbusId(device.serial, 1); // Обновляем ID через команду
	}

	log.info("Устройства на шине: ", JSON.stringify(devices, null, 2));
}


// ===================================================================================================== //

// Сканирует устройства на шине и обновляет список известных устройств
function scanAndUpdateDevices() {
	try {
		const devices = scanModbusDevices();
		log.info("Устройства на шине: ", JSON.stringify(devices, null, 2));

		let updated = false;

		for (const device of devices) {
			if (!knownDevices.has(device.serial)) {
				// Добавляем новые устройства при первом запуске
				device.firmwareUpdated = 0;
				knownDevices.set(device.serial, device);
				updated = true;
			} else {
				// Обновляем существующие устройства (если ID изменился)
				const existingDevice = knownDevices.get(device.serial);
				if (existingDevice.modbusId !== device.modbusId) {
					existingDevice.modbusId = device.modbusId;
					updated = true;
				}
			}
		}

		updateDeviceIds(knownDevices);

		if (isFirstRun) { isFirstRun = false; } // После первого запуска сбрасываем флаг
		updateStatus("Сканирование завершено...");
	} catch (error) {
		log.error("Ошибка при сканировании устройств:", error);
		updateStatus("Ошибка сканирования");
	}
}

// Выполняет сканирование Modbus устройств и возвращает список найденных устройств
function scanModbusDevices() {
	try {
		log.info("Запуск сканирования устройств Modbus...");
		const stdout = execSync("wb-modbus-scanner -d /dev/ttyRS485-1 -b 9600").toString();
		return parseModbusOutput(stdout); // Парсим вывод сканера
	} catch (error) {
		log.error("Ошибка сканирования Modbus:", error);
		throw error;
	}
}

// Функция для парсинга вывода команды
function parseModbusOutput(output) {
	const lines = output.split("\n"); // Разбиваем вывод на строки
	const devices = []; // Массив для хранения устройств

	// Регулярное выражение для извлечения данных
	const regex = /Found device \(\s*(\d+)\) with serial\s+(\d+)\s+\[([^\]]+)\]\s+modbus id:\s+(\d+)\s+model:\s+([^\s]+)/;

	lines.forEach((line) => {
		const match = line.match(regex);
		if (match) {
			const device = {
				id: parseInt(match[1], 10), // Номер устройства
				serial: parseInt(match[2], 10), // Серийный номер
				serialHex: match[3], // Серийный номер в HEX
				modbusId: parseInt(match[4], 10), // Modbus ID
				model: match[5], // Модель устройства
				firmwareUpdated: 0 // По умолчанию 0 (устройство не прошито)
			};
			devices.push(device); // Добавляем устройство в массив
		}
	});

	return devices; // Возвращаем массив устройств
}

// Функция для добавления флага "firmwareUpdated" (0 или 1)
function addFirmwareFlag(devices) {
	// Здесь можно добавить логику для определения, прошито ли устройство
	// Например, можно проверять базу данных или файл конфигурации
	// В данном примере просто возвращаем устройства с флагом 0
	return devices.map(device => ({ ...device, firmwareUpdated: 0 }));
}

function findNextEmptyModbusId(minId){
	let nextId = minId;
	let hasEqualId = false;
	do {
		hasEqualId = false;
		for (const device of devices) {
			if (device.modbusId === nextId){
				hasEqualId = true;
				nextId++;
				break;
			}
		}
	} while(hasEqualId);
	return nextId;
}

// Функция для обновления Modbus ID устройств
function updateDeviceIds(devices) {
	//let nextId = 2; // Начинаем с 2, так как 1 будет назначаться позже
	for (const device of devices) {
		if (device.modbusId === 1 && !device.firmwareUpdated) {
			// Здесь мы всегда присваиваем новый modbusId устройствам
			
			device.modbusId = findNextEmptyModbusId(2);
			setModbusId(device.serial, nextId); // Обновляем ID через команду
		}
		//nextId++; // Увеличиваем ID для следующего устройства
	}

	log.info(`Полный массив: ${JSON.stringify(devices)}`);

	// firmwareDeviceIds(devices);

	// // Проверяем, пропало ли устройство с modbusId = 1
	// const devicesAfterFlash = scanModbusDevices();
	// const hasDeviceWithId1AfterFlash = devicesAfterFlash.some(device => device.modbusId === 1);
	// if (!hasDeviceWithId1AfterFlash) {
	// 	// Находим прошитое устройство с наименьшим modbusId
	// 	const nextDeviceToUpdate = devicesAfterFlash
	// 		.filter(device => device.firmwareUpdated === 1)
	// 		.sort((a, b) => a.modbusId - b.modbusId)[0];

	// 	if (nextDeviceToUpdate) {
	// 		setModbusId(nextDeviceToUpdate.serial, 1);
	// 		nextDeviceToUpdate.modbusId = 1;
	// 	}
	// }

}

function firmwareDeviceIds(devices) {
	// Находим устройство с firmwareUpdated = 0 для прошивки
	const deviceToFlash = devices.find(device => device.firmwareUpdated === 0);
	if (deviceToFlash) {
		//device.firmwareUpdated = 1; // Устанавливаем флаг прошивки
		deviceToFlash.firmwareUpdated = 1; // Устанавливаем флаг прошивки

		log.info(`Статус обновлен: ${JSON.stringify(deviceToFlash)}`);
		log.info(`Полный массив: ${JSON.stringify(devices)}`);

		// firmwareDevice(deviceToFlash); // Прошиваем устройство

		// Проверяем, есть ли устройство с modbusId = 1 и firmwareUpdated = 1
		const deviceWithId1 = devices.find(device => device.modbusId === 1 && device.firmwareUpdated === 1);

		if (!deviceWithId1) {
			// Если устройства с modbusId = 1 нет, выбираем прошитое с наименьшим modbusId
			const nextMasterDevice = devices
				.filter(device => device.firmwareUpdated === 1)
				.sort((a, b) => a.modbusId - b.modbusId)[0];

			if (nextMasterDevice) {
				setModbusId(nextMasterDevice.serial, 1);
				nextMasterDevice.modbusId = 1;
			}
		}
	}
}


// ===================================================================================================== //

// Прошивает указанное устройство
function firmwareDevice(device) {
	try {
		log.info(`Прошивка устройства с серийным номером ${device.serial}...`);
		// Выполняем команду прошивки устройства
		execSync(`./remote_script.sh -b 9600 -a ${device.modbusId} -s -e --port /dev/ttyRS485-1`);
	} catch (error) {
		log.error(`Ошибка прошивки устройства ${device.serial}:`, error);
		throw error;
	}
}

// Устанавливает новый Modbus ID для указанного устройства
function setModbusId(serial, newId) {
	try {
		log.info(`Изменение Modbus ID устройства с серийным номером ${serial} на ${newId}...`);
		execSync(`wb-modbus-scanner -d /dev/ttyRS485-1 -b 9600 -s ${serial} -i ${newId}`);
		log.info(`Modbus ID устройства ${serial} изменен на ${newId}`);
	} catch (error) {
		log.error(`Ошибка изменения Modbus ID у ${serial}:`, error);
		throw error;
	}
}