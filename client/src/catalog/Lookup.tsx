// 選択肢をツールから取る項目(1 つの値)。中身は RemoteSelect。
import { createComponentImplementation } from '@a2ui/react'
import { CommonSchemas } from '@a2ui/web_core/v1_0'
import { z } from 'zod'
import { RemoteSelect } from './RemoteSelect.tsx'

const LookupApi = {
  name: 'Lookup',
  schema: z.object({
    label: z.string(),
    source: z.object({ tool: z.string(), params: z.record(z.string()).optional() }),
    // 選んだ項目の ID。
    value: CommonSchemas.DynamicValue,
    // source.params が引数を取り出す元(フォーム全体の今の値)。
    context: CommonSchemas.DynamicValue.optional(),
  }),
}

export const Lookup = createComponentImplementation(LookupApi, ({ props }) => (
  <div className="lookup">
    <strong>{props.label}</strong>
    <RemoteSelect label={props.label} source={props.source} context={props.context} value={String(props.value ?? '')} onChange={(id) => props.setValue(id)} />
  </div>
))
