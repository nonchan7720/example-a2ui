import { CopilotChat, CopilotKit, useConfigureSuggestions, useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { ReservationApproval, reservationSchema } from './ReservationApproval.tsx'

export function App() {
  return (
    // runtimeUrl は Go のゲートウェイのパス。ゲートウェイがエージェントランタイムへ中継する。
    <CopilotKit runtimeUrl="/api/copilotkit" agentId="default" enableInspector={false}>
      <main>
        <Chat />
      </main>
    </CopilotKit>
  )
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [{ title: '予約する', message: '来週金曜の夜、4人で京都の和食を予約したい。名前は山田です。' }],
    available: 'always',
  })

  // Human in the loop: Claude が呼べる「ブラウザ側のツール」として承認カードを登録する。
  // Claude がこのツールを呼ぶと実行が止まり、render のカードが出る。respond() に渡した値がツールの結果として Claude に返り、同じ実行が続く。
  useHumanInTheLoop({
    agentId: 'default',
    name: 'confirm_reservation',
    description:
      'Show the user an approval card for a reservation before it is saved. The user can change the values. Returns {"approved": true, ...values to use} or {"approved": false}.',
    parameters: reservationSchema,
    render: ReservationApproval,
  })

  return <CopilotChat agentId="default" />
}
