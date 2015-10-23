require('sugar');
var moment = require('moment');
var sequelize = require('./db');
var q = require('q');

var weekdays = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

var WORK_DAY_MINUTES = 8.5 * 60;

function minutesToHuman(minutes) {
	var hours = (minutes / 60).floor();
	var hoursMinutes = minutes % 60;
	return hours + ' ч. ' + hoursMinutes + ' мин.';
}

function get(username) {
	
	// Общее количество минут
	var totalMinutes = WORK_DAY_MINUTES * 5;
	
	// Сколько минут осталось
	var leftMinutes = totalMinutes;
	
	// Берем время работы с начала недели
	var startOfWeek = moment().startOf('isoweek').format('YYYY-MM-DD');
	
	// Количество прошедших дней с начала недели = номеру сегодняшнего дня недели
	var daysPassed = moment().isoWeekday();
// 	var daysPassed = 4;

 	// Не учитываем выходные
	if(daysPassed > 5) daysPassed = 5;
	
	var workTimes = sequelize.query(
		"SELECT date, direction FROM work_times WHERE user_id = '" + username + "' AND DATE(date) >= '" + startOfWeek + "' ORDER BY date ASC", 
		{type: sequelize.QueryTypes.SELECT}
	);

	return workTimes.then(function(data) {
		var daysArray = getRemaining(data);
// 		console.log(daysArray);

		// Массив дней недели и данным по ним
		var daysObjectsArray = [];
		
		// Если некоторые дни были пропущены, считаем их как отработанные полный рабочий день
		leftMinutes -= (daysPassed - daysArray.length) * WORK_DAY_MINUTES;
		
		var totalOverUnderTime = 0;
		
		daysArray.forEach(function(day) {
			
			// Переработка или недоработка
			var overUnder = day.minutes > WORK_DAY_MINUTES;// ? 'переработка' : 'недоработка';
			var overUnderMinutes = Math.abs((leftMinutes >= WORK_DAY_MINUTES ? WORK_DAY_MINUTES : leftMinutes) - day.minutes);
			if(day.outDate != null) {
				totalOverUnderTime += day.minutes > WORK_DAY_MINUTES ? overUnderMinutes : -overUnderMinutes;				
			}
			
			// Если день длился ровно 8 ч 30 мин, не показываем нулевую переработку/недоработку
// 			if(overUnderMinutes != 0) {				
				if(day.inDate != null) {
					var from = day.inDate.format('HH:mm');
					var to = 'сейчас';
					if(day.outDate != null) to = day.outDate.format('HH:mm');
				}
// 			}
			daysObjectsArray.push({
				// День недели (строкой)
				weekdayName: weekdays[day.day],
				
				// Сколько отработал за этот день
				workedThisDay: minutesToHuman(day.minutes),
				
				// Недоработка или переработка
				overUnder: overUnder,
				
				// Количество минут переработка/недоработки
				overUnderMinutes: overUnderMinutes,
				
				// Время недоработки/переработки в тексте
				overUnderText: minutesToHuman(overUnderMinutes),
								
				// Информация о дне
				day: day,
				
				// Время прихода (строкой)
				from: from,
				
				// Время ухода (строкой)
				to: to
			});
			
			leftMinutes -= day.minutes;
		});
		console.log(daysObjectsArray);
		
		
		var latestDay = {
			day: moment(),
			minutes: 0,
			inDate: moment()
		};
		if(daysArray.length > 0) latestDay = daysArray[daysArray.length - 1];
		
		// Подсчет окончания рабочего дня
		// Если на неделе осталось отработать больше одного рабочего дня, тогда считаем с учетом того, что уже было отработано сегодня
		// В противном случае (по пятницам, например), конец дня это сейчас + сколько осталось отработать всего
// 		var endOfCurrentDay = moment().add((leftMinutes >= WORK_DAY_MINUTES ? WORK_DAY_MINUTES - latestDay.minutes : leftMinutes), 'minutes');
// 		
		// Подсчет идеального окончания рабочего дня
		// Время прихода сегодня + 8 ч 30 мин
		var endOfCurrentDay = moment(latestDay.inDate).add(WORK_DAY_MINUTES, 'minutes');	
		
		// Количество минут, которые в среднем надо отработать оставшиеся дни в день
		if(daysArray.length > 0) {
			var minutesPerLeftDays = WORK_DAY_MINUTES - (totalOverUnderTime / (5 - daysArray.length + 1)).floor();		
		}
		else {			
			var minutesPerLeftDays = WORK_DAY_MINUTES;
		}
		
		// Время рекомендованного конца рабочего дня
		var recommendedEndOfCurrentDay = latestDay.inDate.add(minutesPerLeftDays, 'minutes');		
		
		var result = {
			daysObjectsArray: daysObjectsArray,
			
			// Осталось всего
			left: minutesToHuman(leftMinutes),
			
			// Осталось примерно в день
			leftPerDay: minutesToHuman(minutesPerLeftDays),
			
			// Идеальный конец рабочего дня
			endDay: endOfCurrentDay.format('HH:mm'),
			
			// 'Рекомендуемый конец рабочего дня
			recommendedEndDay: recommendedEndOfCurrentDay.format('HH:mm'),
		};

		return result;
	});	
};

// Получить соответствие дня недели и проработанных в этот день минут
function getRemaining(workTimes) {
	
	// Делим объекты просто на группы по 2 (вход и выход), они в идеале должны чередоваться
	var groups = workTimes.inGroupsOf(2, {});
	var data = groups.map(function(group) {
		
		// Находим объекты входа и выхода
		var inItem  = group.find(function(item) { return item.direction === 'in'; });
		var outItem = group.find(function(item) { return item.direction === 'out'; });
		
		var inDate = moment(inItem.date);
				
		// Если не было выхода, считаем его как сейчас
		if(outItem == null) {
			return {day: inDate.isoWeekday(), minutes: moment().diff(inDate, 'minutes'), inDate: inDate};
		}
		
		var outDate = moment(outItem.date);
		
		return {
			day: inDate.isoWeekday(),
			minutes: outDate.diff(inDate, 'minutes'),
			inDate: inDate,
			outDate: outDate
		};
	});
	
	var weekdays = data.map(function(day) { return day.day; });
	var currentWeekday = moment().isoWeekday();
	
	// Заполняем пропущенные дни значениями по умолчанию
	(1).upto(currentWeekday).forEach(function(weekday, index) {
		if(weekdays.indexOf(weekday) === -1) {
			var date = moment().startOf('isoweek').add(weekday, 'days');
			data.insert({fake: true, day: weekday, minutes: WORK_DAY_MINUTES, inDate: date.hours(9).minutes(0), outDate: date.hours(17).minutes(30)}, index);
		}
	});
	
	return data;
};
function write(username) {
	
	var date = moment();
	
	return sequelize.query("SELECT * FROM work_times WHERE DATE(date) = '" + date.format('YYYY-MM-DD') + "' AND user_id = '" + username + "'")
	.spread(function(result) {
		
		var lastDirection = 'out';
		if(result.length) {
			lastDirection = result[result.length - 1].direction;
		}
		
		if(lastDirection === 'in') {
			lastDirection = 'out';			
		}
		else {
			lastDirection = 'in';
		}
		
		var query = "INSERT INTO work_times (date, direction, user_id) VALUES ('" + date.format('YYYY-MM-DD HH:mm:ss') +  "', '" + lastDirection + "', '" + username + "')";
		return sequelize.query(query);	
	});		
}

function subscribe(username, slackUsername) {
	return sequelize.query("SELECT * FROM subscriptions WHERE username = '" + username + "'").spread(function(data) {
		var sub = data.length > 0 ? data[0] : null;
		var promise = q(null);
		if(sub != null) {
			var promise = sequelize.query("DELETE FROM subscriptions WHERE username = '" + username + "'")
		}
		promise.then(function() {
			if(slackUsername) {
				sequelize.query("INSERT INTO subscriptions (username, slack_username) VALUES('" + username + "', '" + slackUsername + "')");
			}				
		})
	})	
}

module.exports.get = get;
module.exports.subscribe = subscribe;
module.exports.write = write;
module.exports.minutesToHuman = minutesToHuman;