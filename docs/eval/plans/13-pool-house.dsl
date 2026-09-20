plan "Pool house" walls 0.25/0.1

room vestiario "Changing room" utility rect 0,0 3.5x3
room wc "WC" wc rect 3.5,0 1.6x3
outdoor deck "Deck" rect 0,3 10x7

door deck>vestiario w0.9 entrance swing:vestiario
door vestiario>wc w0.7 swing:wc
window vestiario.north w1.2
window wc.east w0.5

fixture pool in:deck at 1.5,4 size 7x4 "Pool" depth:1.4
fixture wc in:wc at 3.8,0.3 size 0.4x0.7
fixture shower in:vestiario at 0.2,0.2 size 0.9x0.9
