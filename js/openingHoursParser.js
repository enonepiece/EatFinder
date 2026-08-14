/**
 * openingHoursParser.js - 營業時間解析與營業狀態判斷
 */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export const OpeningHoursParser = {
  /**
   * 解析營業時間並傳回今日營業狀態與營業時間字串
   * @param {string} rawOpeningHours OSM 原始 opening_hours 字串
   * @param {Date} [nowDate] 測試或當前時間
   * @returns {{
   *   isOpen: boolean|null,
   *   statusText: string,
   *   todayHoursText: string,
   *   raw: string
   * }}
   */
  parse(rawOpeningHours, nowDate = new Date()) {
    if (!rawOpeningHours || typeof rawOpeningHours !== 'string') {
      return {
        isOpen: null, // 未提供營業時間
        statusText: '營業時間未提供',
        todayHoursText: '未提供詳細時段',
        raw: ''
      };
    }

    const str = rawOpeningHours.trim();

    // 1. 24 小時營業
    if (/^24\/7$/i.test(str) || /^24\s*hours/i.test(str)) {
      return {
        isOpen: true,
        statusText: '24 小時營業中',
        todayHoursText: '24 小時營業',
        raw: str
      };
    }

    const dayIndex = nowDate.getDay(); // 0: Su, 1: Mo, ...
    const curDayCode = DAYS[dayIndex];
    const curMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

    // 分割規則 (支援以分號或換行分割)
    const rules = str.split(/;|\n/).map(r => r.trim()).filter(Boolean);
    let todayRanges = [];
    let isExplicitlyClosedToday = false;

    for (const rule of rules) {
      const parsedRule = this.parseSingleRule(rule, curDayCode);
      if (parsedRule) {
        if (parsedRule.off) {
          isExplicitlyClosedToday = true;
          todayRanges = [];
        } else if (parsedRule.ranges.length > 0) {
          todayRanges.push(...parsedRule.ranges);
        }
      }
    }

    // 若無法用進階規則解析，嘗試簡易時段解析 (如 "11:00-21:00" 或 "11:00-14:00, 17:00-21:00")
    if (todayRanges.length === 0 && !isExplicitlyClosedToday) {
      const fallbackRanges = this.extractTimeRanges(str);
      if (fallbackRanges.length > 0 && !/[a-zA-Z]{2}/.test(str)) {
        todayRanges = fallbackRanges;
      }
    }

    if (isExplicitlyClosedToday) {
      return {
        isOpen: false,
        statusText: '今日公休',
        todayHoursText: '今日公休',
        raw: str
      };
    }

    if (todayRanges.length === 0) {
      // 雖然有 opening_hours，但格式非標準或今日無對應條目
      return {
        isOpen: null,
        statusText: '營業中 (依公告為準)',
        todayHoursText: str.length > 30 ? str.substring(0, 30) + '...' : str,
        raw: str
      };
    }

    // 檢查目前時間是否落在今日時段內
    let isOpenNow = false;
    let nextOpenTime = null;
    let nextCloseTime = null;

    for (const r of todayRanges) {
      if (curMinutes >= r.start && curMinutes <= r.end) {
        isOpenNow = true;
        nextCloseTime = r.end;
        break;
      } else if (curMinutes < r.start) {
        if (!nextOpenTime || r.start < nextOpenTime) {
          nextOpenTime = r.start;
        }
      }
    }

    const todayHoursFormatted = todayRanges
      .map(r => `${this.formatMinutes(r.start)} - ${this.formatMinutes(r.end)}`)
      .join(', ');

    let statusText = '';
    if (isOpenNow) {
      if (nextCloseTime) {
        statusText = `營業中 (至 ${this.formatMinutes(nextCloseTime)})`;
      } else {
        statusText = '營業中';
      }
    } else {
      if (nextOpenTime) {
        statusText = `休息中 (${this.formatMinutes(nextOpenTime)} 開始營業)`;
      } else {
        statusText = '本日已打烊';
      }
    }

    return {
      isOpen: isOpenNow,
      statusText: statusText,
      todayHoursText: todayHoursFormatted,
      raw: str
    };
  },

  /**
   * 解析單條規則 (例如 "Mo-Fr 09:00-18:00", "Tu,Th off", "11:00-21:00")
   */
  parseSingleRule(ruleStr, targetDay) {
    // 檢查是否含有 "off" 或 "closed"
    const isOff = /\b(off|closed)\b/i.test(ruleStr);

    // 檢查星期區間 (如 Mo-Fr, Sa-Su, Mo,We,Fr)
    const dayMatch = ruleStr.match(/([A-Z][a-z](?:-[A-Z][a-z]|,[A-Z][a-z])*)/i);
    let appliesToday = false;

    if (dayMatch) {
      const daysPart = dayMatch[1];
      appliesToday = this.matchDay(daysPart, targetDay);
    } else {
      // 若無指明星期，預設適用所有日子
      appliesToday = true;
    }

    if (!appliesToday) {
      return null;
    }

    if (isOff) {
      return { off: true, ranges: [] };
    }

    const ranges = this.extractTimeRanges(ruleStr);
    return { off: false, ranges };
  },

  /**
   * 檢查 targetDay 是否落在 daysPart 內
   */
  matchDay(daysPart, targetDay) {
    const parts = daysPart.split(',').map(s => s.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [d1, d2] = part.split('-').map(s => s.trim());
        const i1 = DAYS.indexOf(this.capitalize(d1));
        const i2 = DAYS.indexOf(this.capitalize(d2));
        const it = DAYS.indexOf(targetDay);
        if (i1 !== -1 && i2 !== -1 && it !== -1) {
          if (i1 <= i2) {
            if (it >= i1 && it <= i2) return true;
          } else {
            // 跨週情況 (例如 Fr-Mo: 5,6,0,1)
            if (it >= i1 || it <= i2) return true;
          }
        }
      } else {
        if (this.capitalize(part) === targetDay) return true;
      }
    }
    return false;
  },

  /**
   * 從字串中萃取時間區間 (如 11:00-14:00, 17:00-21:30)
   */
  extractTimeRanges(str) {
    const regex = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
    const ranges = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
      const startH = parseInt(match[1], 10);
      const startM = parseInt(match[2], 10);
      let endH = parseInt(match[3], 10);
      const endM = parseInt(match[4], 10);

      // 若營業到 24:00
      let start = startH * 60 + startM;
      let end = endH * 60 + endM;
      if (end === 0 && endH === 24) end = 24 * 60;
      if (end < start) {
        // 跨夜 (例如 18:00 - 02:00)，此處簡化為當日到 24:00
        end = 24 * 60;
      }
      ranges.push({ start, end });
    }
    return ranges;
  },

  formatMinutes(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
};
