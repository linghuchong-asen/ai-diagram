import { NodeView } from '@antv/x6'

export class SimpleNodeView extends NodeView {
  public update() {
    super.update({
      body: {
        refWidth: '100%',
        refHeight: '100%',
        fill: '#7c86e8',
      },
    })
  }
  protected renderMarkup() {
    // X6 1.x 的 NodeView 在运行时提供 renderJSONMarkup，
    // 但其类型声明中未导出该方法，故此处做类型断言。
    return (this as unknown as { renderJSONMarkup(markup: unknown): void }).renderJSONMarkup({
      tagName: 'rect',
      selector: 'body',
    })
  }
}
