/*
 * @Author: yangsen
 * @Date: 2021-10-21 13:42:02
 * @LastEditTime: 2022-04-20 13:38:08
 * @Description: file content
 */

// 获取svg图片的方法
export const getSVgImgUrl = (fileName: string) => {
  const { href } = new URL(`../assets/img/${fileName}.svg`, import.meta.url);
  return href;
};
