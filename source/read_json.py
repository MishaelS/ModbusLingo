import json
import xml.etree.ElementTree as ET
from tkinter import filedialog, messagebox, Tk, Button
from tkinter import *
from tkinter import ttk


# ------------------------------------------------------------ #

class SimpleTranslator:
    def __init__(self, root):
        self.root = root
        self.root.title("XML Translator")

        self.json_data = None
        self.xml_file = None

        btn_open_json = ttk.Button(root, text="JSON", command=self.load_json)
        btn_open_xml = ttk.Button(root, text="XML", command=self.load_xml)
        btn_translate = ttk.Button(root, text="Перевести XML", command=self.translate_xml)
        self.language_var = ttk.Combobox(root, values=["RU", "EN"], state="readonly")
        self.language_var.current(0)  # Устанавливаем RU по умолчанию

        btn_open_json.grid(row=0, column=0, padx=5, pady=5)
        btn_open_xml.grid(row=0, column=1, padx=5, pady=5)
        btn_translate.grid(row=0, column=2, padx=5, pady=5)
        self.language_var.grid(row=0, column=3, padx=5, pady=5)


    def load_json(self):
        file = filedialog.askopenfilename(filetypes=[("JSON files", "*.json")])
        if file:
            try:
                with open(file, 'r', encoding='utf-8') as f:
                    selected_language = self.language_var.get()  # Получаем выбранный язык
                    self.json_data = json.load(f).get(selected_language, {}).get("Title", {})
                messagebox.showinfo("Успех", f"JSON загружен для языка: {selected_language}")
            except Exception as e:
                messagebox.showerror("Ошибка", f"Ошибка при чтении JSON: {e}")


    def load_xml(self):
        file = filedialog.askopenfilename(filetypes=[("XML files", "*.xml")])
        if file:
            self.xml_file = file
            messagebox.showinfo("Успех", "XML загружен!")


    def translate_xml(self):
        if not self.json_data or not self.xml_file:
            messagebox.showwarning("Ошибка", "Загрузите JSON и XML!")
            return

        try:
            tree = ET.parse(self.xml_file)
            root = tree.getroot()

            # Переводим текст внутри тегов
            for elem in root.iter():
                if elem.text and elem.text.strip() in self.json_data:
                    elem.text = self.json_data[elem.text.strip()]

                # Переводим атрибуты тега
                for key, value in elem.attrib.items():
                    if value in self.json_data:
                        elem.set(key, self.json_data[value])

            save_path = filedialog.asksaveasfilename(defaultextension=".xml", filetypes=[("XML files", "*.xml")])
            if save_path:
                tree.write(save_path, encoding='utf-8', xml_declaration=True)
                messagebox.showinfo("Успех", "XML переведён!")
        except Exception as e:
            messagebox.showerror("Ошибка", f"Ошибка при переводе: {e}")


# ------------------------------------------------------------ #

root = Tk()
app = SimpleTranslator(root)
root.mainloop()
