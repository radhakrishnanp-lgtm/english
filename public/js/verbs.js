// Common irregular verbs: base | past simple | past participle | meaning
const RAW = `
be|was/were|been|exist; is/am/are
beat|beat|beaten|hit many times; win against
become|became|become|start to be
begin|began|begun|start
bend|bent|bent|make or become curved
bet|bet|bet|risk money on a result
bite|bit|bitten|cut with your teeth
blow|blew|blown|move air out of your mouth
break|broke|broken|make something go into pieces
bring|brought|brought|carry to here
build|built|built|make a house, wall etc.
burn|burnt/burned|burnt/burned|be on fire; damage with fire
buy|bought|bought|get something by paying
catch|caught|caught|take and hold something moving
choose|chose|chosen|pick one thing from many
come|came|come|move towards here
cost|cost|cost|have a price
cut|cut|cut|open or divide with a knife
deal|dealt|dealt|handle; give out cards
dig|dug|dug|make a hole in the ground
do|did|done|perform an action
draw|drew|drawn|make a picture with a pencil
dream|dreamt/dreamed|dreamt/dreamed|see pictures while sleeping
drink|drank|drunk|take liquid into your mouth
drive|drove|driven|control a car
eat|ate|eaten|take food into your mouth
fall|fell|fallen|go down to the ground
feed|fed|fed|give food to
feel|felt|felt|experience an emotion or touch
fight|fought|fought|use force against someone
find|found|found|discover where something is
fly|flew|flown|move through the air
forbid|forbade|forbidden|not allow
forget|forgot|forgotten|not remember
forgive|forgave|forgiven|stop being angry with someone
freeze|froze|frozen|become ice
get|got|got (US gotten)|receive; become; arrive
give|gave|given|hand something to someone
go|went|gone|move to another place
grow|grew|grown|become bigger
hang|hung|hung|fix something at the top so it hangs down
have|had|had|own; possess
hear|heard|heard|notice sounds with your ears
hide|hid|hidden|put where nobody can see
hit|hit|hit|touch with force
hold|held|held|have in your hand
hurt|hurt|hurt|cause pain
keep|kept|kept|continue to have
know|knew|known|have information
lay|laid|laid|put down flat (e.g. lay the table)
lead|led|led|show the way; be in charge
learn|learnt/learned|learnt/learned|get knowledge
leave|left|left|go away from
lend|lent|lent|give something for a short time
let|let|let|allow
lie|lay|lain|be in a flat position (lie down)
light|lit|lit|start a fire or lamp
lose|lost|lost|not be able to find; not win
make|made|made|create; produce
mean|meant|meant|have the meaning of
meet|met|met|see and talk to someone
pay|paid|paid|give money for something
put|put|put|place something somewhere
quit|quit|quit|stop doing something
read|read (red)|read (red)|look at words and understand
ride|rode|ridden|travel on a bike or horse
ring|rang|rung|make a bell sound; phone
rise|rose|risen|go up
run|ran|run|move fast on your feet
say|said|said|speak words
see|saw|seen|notice with your eyes
sell|sold|sold|give something for money
send|sent|sent|make something go somewhere
set|set|set|put in place; fix a time
shake|shook|shaken|move quickly up and down
shine|shone|shone|give out light
shoot|shot|shot|fire a gun
show|showed|shown|let someone see
shut|shut|shut|close
sing|sang|sung|make music with your voice
sink|sank|sunk|go down under water
sit|sat|sat|be on a chair
sleep|slept|slept|rest with eyes closed
slide|slid|slid|move smoothly over a surface
speak|spoke|spoken|say words; talk
spend|spent|spent|use money or time
split|split|split|divide into parts
spread|spread|spread|open out; cover a surface
stand|stood|stood|be on your feet
steal|stole|stolen|take without permission
stick|stuck|stuck|fix with glue
sting|stung|stung|hurt with a small sharp point (a bee)
strike|struck|struck|hit; stop work as a protest
swear|swore|sworn|make a promise; use bad words
sweep|swept|swept|clean with a brush
swim|swam|swum|move through water
swing|swung|swung|move from side to side
take|took|taken|carry away; get
teach|taught|taught|help someone learn
tear|tore|torn|pull into pieces
tell|told|told|give information to someone
think|thought|thought|use your mind
throw|threw|thrown|send through the air with your hand
understand|understood|understood|know the meaning
wake|woke|woken|stop sleeping
wear|wore|worn|have clothes on your body
win|won|won|be first; get a prize
write|wrote|written|put words on paper`;

export const VERBS = RAW.trim().split('\n').map((l) => {
  const [base, past, pp, meaning] = l.split('|');
  return { base, past, pp, meaning };
});

/** Groups that follow the same pattern — helps learners remember. */
export const VERB_GROUPS = [
  ['All three the same', ['cost', 'cut', 'hit', 'hurt', 'let', 'put', 'quit', 'set', 'shut', 'split', 'spread', 'bet']],
  ['Past = participle (-t / -d)', ['build', 'bend', 'lend', 'send', 'spend', 'feel', 'keep', 'leave', 'mean', 'meet', 'sleep', 'sweep', 'deal', 'lead', 'feed', 'hold', 'sell', 'tell', 'find', 'have', 'hear', 'make', 'pay', 'say', 'stand', 'understand', 'lose', 'shoot', 'sit', 'light']],
  ['-ought / -aught', ['bring', 'buy', 'fight', 'think', 'catch', 'teach']],
  ['i - a - u', ['begin', 'drink', 'ring', 'sing', 'sink', 'swim']],
  ['-ew - -own', ['blow', 'grow', 'know', 'throw', 'fly', 'draw']],
  ['-o- - -en', ['break', 'choose', 'freeze', 'speak', 'steal', 'wake', 'forget']],
  ['Base = participle', ['come', 'become', 'run']],
];
