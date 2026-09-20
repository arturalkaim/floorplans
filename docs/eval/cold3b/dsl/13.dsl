plan "Pool house" walls 0.2/0.1

room changing "Changing room" other rect 0,0 3x3
room wc "WC" wc rect 3,0 1.5x3
outdoor deck "Deck" rect 0,3 4.5x6

door changing.west w0.9 entrance
door changing>wc @1 w0.7
door changing>deck @1 w1.5 hinge:start swing:deck

fixture pool in:deck at 0.5,4 size 3x4 "Pool" id:pool1

window wc.east w0.5
