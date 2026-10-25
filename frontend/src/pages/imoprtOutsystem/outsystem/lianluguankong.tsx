/*
 * @Author: yangsen
 * @Date: 2022-04-13 17:22:19
 * @LastEditTime: 2022-05-06 19:38:10
 * @Description: 四川链路管控项目定制导入
 */

import { Button, Card, Form, Select, Upload, notification } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { beforeUplod, G6Translate } from "./G6translate";
import { useForm } from "antd/lib/form/Form";
import { useState } from "react";
import { RcFile, UploadFile } from "antd/lib/upload/interface";
import { useImport } from "./server";

interface onFinishProp {
  swjgDm: string;
  fileResult: { file: RcFile; fileList: RcFile[] };
}
const swjgDmlist = [
  { value: "00000000000", text: " 国家税务总局" },
  { value: "11100000000", text: "	北京市国家税务局" },
  { value: "11300000000", text: "	河北省国家税务局" },
  { value: "11500000000", text: "	内蒙古自治区国家税务局" },
  { value: "12102000000", text: "	大连市国家税务局" },
  { value: "12100000000", text: "	辽宁省国家税务局" },
  { value: "12200000000", text: "	吉林省国家税务局" },
  { value: "12300000000", text: "	黑龙江省国家税务局" },
  { value: "13100000000", text: "	上海市税务局" },
  { value: "13200000000", text: "	江苏省国税局" },
  { value: "13702000000", text: "	青岛市国家税务局" },
  { value: "13302000000", text: "	宁波市国家税务局" },
  { value: "13500000000", text: "	福建省国家税务局" },
  { value: "13600000000", text: "	江西省国家税务局" },
  { value: "13300000000", text: "	浙江省国家税务局" },
  { value: "13400000000", text: "	安徽省国家税务局" },
  { value: "13502000000", text: "	厦门市国家税务局" },
  { value: "14400000000", text: "	广东省国家税务局" },
  { value: "14100000000", text: "	河南省国家税务局" },
  { value: "14500000000", text: "	广西壮族自治区国家税务局" },
  { value: "14200000000", text: "	湖北省国家税务局" },
  { value: "14600000000", text: "	海南省国家税务局" },
  { value: "14300000000", text: "	湖南省国家税务局" },
  { value: "15300000000", text: "	云南省国家税务局" },
  { value: "15100000000", text: "	四川省国家税务局" },
  { value: "15200000000", text: "	贵州省国家税务局" },
  { value: "16100000000", text: "	陕西省国家税务局" },
  { value: "16200000000", text: "	甘肃省国家税务局" },
  { value: "16400000000", text: "	宁夏回族自治区国家税务局" },
  { value: "15400000000", text: "	西藏自治区国家税务局" },
  { value: "11400000000", text: "	山西省国家税务局" },
  { value: "14403000000", text: "	深圳市国家税务局" },
  { value: "13700000000", text: "	山东省国家税务局" },
  { value: "16300000000", text: "	青海省国家税务局" },
  { value: "15000000000", text: "	重庆市国家税务局" },
  { value: "16500000000", text: "	国家税务总局新疆维吾尔自治区税务局" },
  { value: "11200000000", text: "	天津市国家税务局" },
];
export const OutSysLLGK = () => {
  const [form] = useForm();
  const [fileList, setfileList] = useState<UploadFile<unknown>[]>([]);
  const { mutateAsync } = useImport();
  // 点击导入按钮拿到数据。
  const onFinish = async ({ swjgDm, fileResult }: onFinishProp) => {
    try {
      const { file, fileList } = fileResult;
      if (fileList.length === 0) return;
      const resultJson = await G6Translate(file, fileList);
      // 接下来就是调用后端接口了，用mutate的方式，如果成功了要提示导入成功的信息。
      // 导入失败已由 useImport 的 onError 统一提示，此处仅捕获避免 unhandled rejection
      await mutateAsync({
        taxCode: swjgDm,
        jsonData: resultJson,
      });
    } catch (error) {
      // 文件转换失败（G6Translate 内 JSON.parse 等）：明确提示
      notification["error"]({
        message: "文件解析失败",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <Container>
      <Card title="数据治理导入" style={{ width: "90%", margin: "auto" }}>
        <Form
          form={form}
          style={{ display: "flex", justifyContent: "space-between" }}
          onFinish={onFinish}
          initialValues={{ swjgDm: "00000000000", fileResult: { fileList: [], file: [] } }}
        >
          <Form.Item label="税务机关" name="swjgDm">
            <Select style={{ width: 200 }}>
              {swjgDmlist.map((item) => (
                <Select.Option value={item.value} key={item.value}>
                  {item.text}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="文件上传" name="fileResult">
            <Upload
              beforeUpload={beforeUplod(setfileList)}
              onRemove={() => {
                setfileList([]);
              }}
              fileList={fileList}
            >
              <Button icon={<UploadOutlined />}>X6JSON上传</Button>
            </Upload>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              导入
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Container>
  );
};

const Container = styled.div`
  margin-top: 10px;
  padding: 10px;
`;
