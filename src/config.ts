/**
 * 应用配置文件
 * 统一管理应用名称和其他全局配置
 */

import packageJson from '../package.json';

export const APP_CONFIG = {
  /** 应用名称 */
  name: 'AI Calendar',
  
  /** 应用名称首字母（用于 Logo） */
  nameInitial: 'A',
  
  /** 应用描述 */
  description: '日程与周期事务中心',
  
  /** 版本号 */
  version: packageJson.version,
};

export default APP_CONFIG;
