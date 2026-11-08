import { AsyncButton, Button, CopyButton, IconButton, LikeButton, sleep } from '../lib'
import { Row, Section, Spec } from './kit'

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons" desc="Variants, press feedback, and state changes that morph instead of swapping.">
      <Spec title="Variants" desc="One primary per view">
        <Row><Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Delete</Button></Row>
        <Row><Button size="sm">Small</Button><Button variant="accent" size="lg">Large accent</Button><Button loading>Loading</Button><IconButton icon="share" label="Share" size="icon" variant="default" /><IconButton icon="more" label="More" /></Row>
      </Spec>
      <Spec title="Loading to success" desc="Width animates between states">
        <Row><AsyncButton onClick={() => sleep(900)}>Save changes</AsyncButton></Row>
      </Spec>
      <Spec title="Like with burst" desc="Spring scale plus count roll">
        <Row><LikeButton count={128} /><CopyButton text="npm i motion" label="Copy" /></Row>
      </Spec>
    </Section>
  )
}
