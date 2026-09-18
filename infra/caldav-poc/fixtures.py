"""Synthetic modern-date fixtures only. No AI Calendar data is imported."""
from datetime import date, datetime, timedelta, timezone

VTIMEZONE = ['BEGIN:VTIMEZONE', 'TZID:Asia/Shanghai', 'BEGIN:STANDARD',
             'DTSTART:20000101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800',
             'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE']


def text(value):
    return value.replace('\\', '\\\\').replace('\r\n', '\n').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')


def fold(line):
    # RFC 5545: at most 75 octets per physical line, never split a UTF-8 codepoint.
    lines, current = [], ''
    for char in line:
        if len((current + char).encode('utf-8')) > 75:
            lines.append(current)
            current = ' '
        current += char
    return '\r\n'.join(lines + [current])


def calendar(events, zoned=False):
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Calendar//Isolated CalDAV POC//EN', 'CALSCALE:GREGORIAN']
    if zoned:
        lines += VTIMEZONE
    for event in events:
        lines += ['BEGIN:VEVENT'] + event + ['END:VEVENT']
    return ('\r\n'.join(fold(line) for line in lines + ['END:VCALENDAR']) + '\r\n').encode('utf-8')


def fixtures(day=None):
    day = day or (datetime.now(timezone(timedelta(hours=8))).date() + timedelta(days=1))
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    d = day.strftime('%Y%m%d')
    next_d = (day + timedelta(days=1)).strftime('%Y%m%d')

    def event(name, fields):
        return ['UID:poc-' + name + '@example.invalid', 'DTSTAMP:' + stamp,
                'SUMMARY:' + text('POC ' + name + ' 荣耀测试 📅')] + fields

    result = {
        'ordinary': calendar([event('ordinary', ['DTSTART:' + d + 'T060000Z', 'DTEND:' + d + 'T070000Z'])]),
        'all-day': calendar([event('all-day', ['DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next_d])]),
        'cross-midnight': calendar([event('cross-midnight', ['DTSTART;TZID=Asia/Shanghai:' + d + 'T233000', 'DTEND;TZID=Asia/Shanghai:' + next_d + 'T003000'])], True),
        'timezone': calendar([event('timezone', ['DTSTART;TZID=Asia/Shanghai:' + d + 'T140000', 'DTEND;TZID=Asia/Shanghai:' + d + 'T150000'])], True),
        'long-text': calendar([event('long-text', ['DTSTART:' + d + 'T080000Z', 'DTEND:' + d + 'T090000Z',
                            'DESCRIPTION:' + text(('中文 📅 & < > ; , \\ 换行\n' * 30)),
                            'LOCATION:' + text('测试会议室 & <A>，仅合成数据')])]),
    }
    for name, rule in [('daily', 'FREQ=DAILY;COUNT=3'), ('weekly', 'FREQ=WEEKLY;COUNT=3')]:
        result[name] = calendar([event(name, ['DTSTART:' + d + 'T020000Z', 'DTEND:' + d + 'T030000Z', 'RRULE:' + rule])])
    master = event('exception', ['DTSTART:' + d + 'T020000Z', 'DTEND:' + d + 'T030000Z', 'RRULE:FREQ=DAILY;COUNT=3'])
    exception = event('exception', ['RECURRENCE-ID:' + next_d + 'T020000Z', 'DTSTART:' + next_d + 'T040000Z', 'DTEND:' + next_d + 'T050000Z'])
    result['exception'] = calendar([master, exception])
    # Deliberately near-future: import promptly and confirm the phone has synced.
    alarm_time = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=15)
    result['alarm'] = calendar([event('alarm', ['DTSTART:' + alarm_time.strftime('%Y%m%dT%H%M%SZ'),
        'DTEND:' + (alarm_time + timedelta(minutes=30)).strftime('%Y%m%dT%H%M%SZ'),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', 'DESCRIPTION:POC alarm', 'END:VALARM'])])
    return result
