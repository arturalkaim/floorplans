plan "Pool House"

room changing "Changing Room" changing rect 0,0 3x3
room wc "WC" wc rect 3,0 1.5x3
outdoor deck "Deck" rect 0,3 6x6

fixture pool in:deck at 0.5,3.5 size 5x5 "Pool" depth:1.4

door changing.south w0.9 hinge:start swing:changing
door wc.south w0.7 hinge:end swing:wc
