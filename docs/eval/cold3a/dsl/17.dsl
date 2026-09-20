plan "Loft conversion" walls 0.2/0.1

room main "Main room" other rect 0,0 5x4 habitable
room shower "Shower room" bath rect 5,0 1.5x4 wet

door main>shower at 5,2 w0.7
window main.north w1.5
window shower.east w0.5

fixture stairs in:main at 4.3,3.3 size 0.7x0.7 "Stair arrival"
