plan "Two-bedroom flat" walls 0.3/0.12

room corredor "Corridor" corridor rect 0,3.5 9x1.2
room sala "Living room" living rect 0,0 4x3.5
room cozinha "Kitchen" kitchen rect 4,0 5x3.5
room q1 "Bedroom 1" bedroom rect 0,4.7 3.5x3.3
room q2 "Bedroom 2" bedroom rect 3.5,4.7 3.5x3.3
room banho "Bathroom" bath rect 7,4.7 2x3.3

door corredor.west w1 entrance
door corredor>sala w0.9 swing:sala
door corredor>cozinha w0.9 swing:cozinha
door corredor>q1 w0.8 swing:q1
door corredor>q2 w0.8 swing:q2
door corredor>banho w0.7 swing:banho
window sala.north w2
window cozinha.north w1.6
window q1.south w1.6
window q2.south w1.6
window banho.east w0.6
