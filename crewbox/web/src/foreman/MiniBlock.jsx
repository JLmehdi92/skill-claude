import Block from '../board/Block.jsx';

/** A coworker block on its own, outside the board (plan cards, lists). */
export default function MiniBlock({ name, color, status = 'idle', size = 92 }) {
  return (
    <svg className="mini-block" width={size} height={size * 0.78} viewBox="-48 -44 96 75" aria-hidden="true">
      <defs>
        <filter id="rb-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id="rb-eye-glow" x="-100%" y="-200%" width="300%" height="500%"><feGaussianBlur stdDeviation="0.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <Block agent={{ id: `mini-${name}`, name, handle: name }} color={color} status={status} at={[0, 0]} index={0} pulse={null} thought={null} onOpen={() => {}} />
    </svg>
  );
}
