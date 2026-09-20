plan "Pool house" walls 0.2/0.1

room changing "Changing room" other rect 0,0 3x3 habitable
room wc "WC" wc rect 3,0 1.5x3 wet
outdoor deck "Deck" rect 0,3 4.5x6

door changing>deck w1.2 on:changing.south entrance
door changing>wc at 3,1.5 w0.7
window changing.north w1.0
window wc.north w0.5

fixture pool in:deck at 0.5,4 size 3.5x4
fixture wc in:wc at 3.3,0.3 size 0.4x0.6
