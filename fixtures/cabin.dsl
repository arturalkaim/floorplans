plan "Cabana" walls 0.2/0.1

room sala "Sala e cozinha" living rect 0,0 5x4
room wc "Casa de banho" wc rect 5,0 1.2x2
room arrumos "Arrumos" storage rect 5,2 1.2x2
outdoor deck "Deck" rect 0,4 5x2

door deck>sala at:0.9,4 w0.9 hinge:start swing:sala
door sala>wc @-0.5 w0.7 hinge:end swing:wc
door sala>arrumos @0.5 w0.7 hinge:start swing:arrumos
window sala.north @2.5 w2.4
window deck>sala @3.4 w2 on:sala.south
window sala.west w1.2
window wc.east w0.6
