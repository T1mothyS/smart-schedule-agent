export function isReadOnlyScheduleQuery(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  if (/(添加|新建|创建|修改|改成|推迟|提前|取消|删除|删掉|标记完成|帮我安排|给我安排|提醒我)/.test(normalized)) {
    return false;
  }
  return /(有什么安排|有哪些安排|什么安排|有什么日程|有哪些日程|查看.*(?:安排|日程)|查询.*(?:安排|日程)|几点有会)/.test(normalized);
}

const KNOWLEDGE_CONTEXT_TRIGGER = /知识库|knowledge\s+library/i;

export function requestsKnowledgeContext(text: string): boolean {
  return KNOWLEDGE_CONTEXT_TRIGGER.test(text);
}

export function needsScheduleContext(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  if (isReadOnlyScheduleQuery(normalized)) return true;
  if (/(日程|安排|待办|提醒|会议|行程|空闲|有空|冲突|改期|推迟|提前|标记完成)/.test(normalized)) return true;
  const hasDateOrTime = /(今天|明天|后天|大后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[月号日点时]|上午|下午|晚上)/.test(normalized);
  const hasAction = /(去|到|见|开|办|做|交|取|送|买|看|体检|出发|出差|预约|拜访|聚会|吃饭|运动|学习|提交)/.test(normalized);
  return hasDateOrTime && hasAction;
}
