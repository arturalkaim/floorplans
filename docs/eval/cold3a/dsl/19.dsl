plan "Holiday let" walls 0.2/0.1

room bed1 "Bedroom 1" bedroom rect 0,0 3x3 habitable
room bed2 "Bedroom 2" bedroom rect 3,0 3x3 habitable
room living "Living room" living rect 0,3 6x3 habitable
outdoor terrace "Terrace" covered rect 6,0 3x6

door living>terrace at 6,4.5 w1.5 glazed entrance
door bed1>living at 1.5,3 w0.8
door bed2>living at 4.5,3 w0.8
window bed1.north w1.2
window bed2.north w1.2

fixture shower in:terrace at 6.5,0.5 size 1x1
