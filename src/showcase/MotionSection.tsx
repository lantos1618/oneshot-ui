import { MotionPlayground } from '../examples'
import { Section, Spec } from './kit'

export function MotionSection() {
  return (
    <Section id="motion" title="Motion" desc="Tune a spring, see it on real components, copy the exact call.">
      <Spec title="Motion playground" desc="Every animation in this library uses these two numbers. Change them and the previews replay." span={3}>
        <MotionPlayground />
      </Spec>
    </Section>
  )
}
