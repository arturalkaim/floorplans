plan "Office suite" walls 0.3/0.12

room rececao "Reception" office day rect 0,0 5x4
room corredor "Corridor" corridor day rect 5,0 1.4x4
room sala1 "Office 1" office day rect 6.4,0 3.5x2
room sala2 "Office 2" office day rect 6.4,2 3.5x2
room reuniao "Meeting room" office day rect 0,4 9.9x3.5

door rececao.west w1.1 entrance
door rececao>corredor w1 swing:corredor
door corredor>sala1 w0.8 swing:sala1
door corredor>sala2 w0.8 swing:sala2
door rececao>reuniao w0.9 swing:reuniao
window rececao.north w2.4
window sala1.east w1.4
window sala2.east w1.4
window reuniao.south w3
