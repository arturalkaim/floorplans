plan "Studio" walls 0.3/0.1

room sala "Studio" living rect 0,0 5x4
room banho "Shower room" bath rect 5,0 2x4

door sala.west w0.9 entrance
door sala>banho w0.8 swing:banho
window sala.south w1.8
window banho.east w0.6

fixture shower in:banho at 5.2,0.2 size 0.9x0.9
fixture counter in:sala at 0.2,0.2 size 2.4x0.6
